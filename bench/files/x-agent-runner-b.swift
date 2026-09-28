import Foundation
import os

// MARK: - Progress

/// What a run is doing, as it does it.
///
/// Reported at four points rather than one. The version before this fired only
/// after a tool had already run, which meant the longest thing in the loop —
/// the model thinking — was also the only part nothing was said about: a first
/// turn that timed out showed a spinner for three minutes and then an error.
public enum AgentProgress: Equatable, Sendable {
    /// The turn has gone to the model. Reported **before** the request, because
    /// the request is the wait.
    case thinking(turn: Int)
    /// A piece of the model's reasoning, as it is written.
    case thought(String)
    /// A piece of the answer the model is composing.
    case writing(String)
    /// What the model wrote on its way to asking for a tool.
    case said(String)
    /// A tool is about to run, with the arguments it was called with.
    case toolRunning(tool: String, arguments: String)
    /// It answered, and with what.
    case toolFinished(tool: String, callsSoFar: Int, answer: String)
}

// MARK: - Configuration

/// Configuration options for an ``AgentRunner``.
public struct AgentRunnerConfiguration: Sendable {
    /// What the run is allowed to spend.
    public var budget: AgentBudget
    /// The longest a logged answer may be, ellipsis included.
    public var loggedAnswerLength: Int
    /// Whether cancellation and the deadline are also checked after every tool call.
    public var checksInterruptionAfterEachTool: Bool
    /// How a turn that fails is retried.
    public var retryPolicy: AgentRetryPolicy

    /// Creates a configuration.
    ///
    /// - Parameters:
    ///   - budget: What the run is allowed to spend.
    ///   - loggedAnswerLength: The longest a logged answer may be. Defaults to `200`.
    ///   - checksInterruptionAfterEachTool: Whether to check for interruption after each tool call. Defaults to `true`.
    ///   - retryPolicy: How a failed turn is retried. Defaults to ``AgentRetryPolicy/none``.
    public init(
        budget: AgentBudget,
        loggedAnswerLength: Int = AgentRunner.loggedAnswerLength,
        checksInterruptionAfterEachTool: Bool = true,
        retryPolicy: AgentRetryPolicy = .none
    ) {
        self.budget = budget
        self.loggedAnswerLength = loggedAnswerLength
        self.checksInterruptionAfterEachTool = checksInterruptionAfterEachTool
        self.retryPolicy = retryPolicy
    }
}

/// How a turn that throws is retried.
public struct AgentRetryPolicy: Equatable, Sendable {
    /// The most attempts a turn gets, the first one included.
    public var maxAttempts: Int
    /// How long to wait between attempts.
    public var delay: Duration

    /// Creates a retry policy.
    ///
    /// - Parameters:
    ///   - maxAttempts: The most attempts a turn gets.
    ///   - delay: How long to wait between attempts.
    public init(maxAttempts: Int, delay: Duration) {
        self.maxAttempts = maxAttempts
        self.delay = delay
    }

    /// A policy that never retries.
    public static let none = AgentRetryPolicy(maxAttempts: 1, delay: .zero)
}

// MARK: - Delegate

/// Hooks that let a caller observe a run as it happens.
public protocol AgentRunnerDelegate: AnyObject, Sendable {
    /// Called before a turn is sent to the model.
    func agentRunner(_ runner: AgentRunner, willStartTurn turn: Int) async
    /// Called when the model has replied.
    func agentRunner(_ runner: AgentRunner, didReceive reply: AgentMessage, turn: Int) async
    /// Called before a tool runs.
    func agentRunner(_ runner: AgentRunner, willRun call: AgentToolCall) async
    /// Called after a tool has run.
    func agentRunner(_ runner: AgentRunner, didRun call: AgentToolCall, answer: String) async
    /// Called when the run has finished.
    func agentRunner(_ runner: AgentRunner, didFinishWith outcome: AgentOutcome) async
}

public extension AgentRunnerDelegate {
    func agentRunner(_ runner: AgentRunner, willStartTurn turn: Int) async {}
    func agentRunner(_ runner: AgentRunner, didReceive reply: AgentMessage, turn: Int) async {}
    func agentRunner(_ runner: AgentRunner, willRun call: AgentToolCall) async {}
    func agentRunner(_ runner: AgentRunner, didRun call: AgentToolCall, answer: String) async {}
    func agentRunner(_ runner: AgentRunner, didFinishWith outcome: AgentOutcome) async {}
}

// MARK: - Tool Registry

/// Stores the tools available to a run, keyed by name.
public final class AgentToolRegistry: @unchecked Sendable {
    private var toolsByName: [String: any AgentTool] = [:]
    private var orderedSpecs: [AgentToolSpec] = []

    /// Creates a registry holding the given tools.
    ///
    /// - Parameter tools: The tools to register.
    public init(tools: [any AgentTool] = []) {
        tools.forEach { register($0) }
    }

    /// Registers a tool. The first tool registered under a name wins.
    ///
    /// - Parameter tool: The tool to register.
    public func register(_ tool: any AgentTool) {
        orderedSpecs.append(tool.spec)
        guard toolsByName[tool.name] == nil else { return }
        toolsByName[tool.name] = tool
    }

    /// Returns the tool with the given name, if there is one.
    ///
    /// - Parameter name: The name of the tool.
    /// - Returns: The tool, or `nil`.
    public func tool(named name: String) -> (any AgentTool)? {
        return toolsByName[name]
    }

    /// Whether a tool with the given name is registered.
    ///
    /// - Parameter name: The name of the tool.
    /// - Returns: `true` if the tool is registered.
    public func contains(_ name: String) -> Bool {
        return toolsByName[name] != nil
    }

    /// The specs of every registered tool, in registration order.
    public var specs: [AgentToolSpec] {
        return orderedSpecs
    }

    /// The names of every registered tool, in registration order.
    public var names: [String] {
        return orderedSpecs.map(\.name)
    }

    /// The number of registered tools.
    public var count: Int {
        return toolsByName.count
    }
}

// MARK: - Tool Execution

/// Runs a single tool call.
public protocol AgentToolExecuting: Sendable {
    /// Runs the given call and returns the answer to send back to the model.
    ///
    /// - Parameter call: The call to run.
    /// - Returns: The tool's answer.
    func execute(_ call: AgentToolCall) async -> String
}

/// The default tool executor, which looks each tool up in a registry.
public struct DefaultAgentToolExecutor: AgentToolExecuting {
    private let registry: AgentToolRegistry
    private let logger: (any AgentLogger)?
    private let loggedAnswerLength: Int

    /// Creates an executor.
    ///
    /// - Parameters:
    ///   - registry: Where the tools are looked up.
    ///   - logger: Where the calls are logged.
    ///   - loggedAnswerLength: The longest a logged answer may be.
    public init(registry: AgentToolRegistry, logger: (any AgentLogger)?, loggedAnswerLength: Int) {
        self.registry = registry
        self.logger = logger
        self.loggedAnswerLength = loggedAnswerLength
    }

    /// One call's answer. A tool that is not here is told so, in words the model
    /// can act on: naming the tools that do exist turns a dead end into a retry.
    public func execute(_ call: AgentToolCall) async -> String {
        AgentRunner.debugLog.debug("execute(_:) called for \(call.name, privacy: .public)")
        guard let tool = registry.tool(named: call.name) else {
            AgentRunner.debugLog.warning("Unknown tool requested: \(call.name, privacy: .public)")
            logger?.log(.toolUnknown(name: call.name))
            let offered = registry.names.sorted().joined(separator: ", ")
            return #"{"error":"There is no tool called \#(call.name). The tools are: \#(offered)."}"#
        }
        logger?.log(.toolCalled(name: call.name, arguments: call.arguments))
        let arguments = makeArguments(for: call)
        let result = await tool.run(arguments)
        logger?.log(.toolAnswered(
            name: call.name, characters: result.count, answer: truncatedForLog(result)
        ))
        AgentRunner.debugLog.debug("Tool \(call.name, privacy: .public) answered with \(result.count) characters")
        return result
    }

    /// Builds the arguments for a call.
    ///
    /// - Parameter call: The call.
    /// - Returns: The call's arguments.
    private func makeArguments(for call: AgentToolCall) -> ToolArguments {
        return ToolArguments(json: call.arguments)
    }

    /// The readable beginning of an answer: one line, cut to length.
    ///
    /// - Parameter answer: The answer to shorten.
    /// - Returns: The shortened answer.
    private func truncatedForLog(_ answer: String) -> String {
        let line = answer.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        guard line.count > loggedAnswerLength else { return line }
        return String(line.prefix(loggedAnswerLength - 1)) + "…"
    }
}

// MARK: - Runner

/// Drives a tool-calling conversation to its end.
///
/// The whole loop is: send the history, append what came back, run whatever it
/// asked for, append one answer per call, go round again. It stops when the
/// model replies with words and no calls, or when one of the three budgets runs
/// out.
public final class AgentRunner: @unchecked Sendable {
    /// Logger used to debug the runner itself.
    static let debugLog = Logger(subsystem: "org.example.fieldmark", category: "AgentRunner")

    /// The longest a logged answer may be, ellipsis included.
    public static let loggedAnswerLength = 200

    private let chat: any AgentChatting
    private let registry: AgentToolRegistry
    private let executor: any AgentToolExecuting
    private let configuration: AgentRunnerConfiguration
    private let logger: (any AgentLogger)?
    private let clock: any AgentClock

    /// The delegate told about the run as it moves.
    public weak var delegate: (any AgentRunnerDelegate)?

    /// Called as the run moves. Awaited inline rather than fired into a task,
    /// so a feed reads in the order things actually happened.
    public var onProgress: (@Sendable (AgentProgress) async -> Void)?

    /// What the run is allowed to spend.
    private var budget: AgentBudget {
        return configuration.budget
    }

    /// Creates a runner.
    ///
    /// - Parameters:
    ///   - chat: The conversation to drive.
    ///   - tools: The tools the model may call.
    ///   - budget: What the run is allowed to spend.
    ///   - logger: Where the run's narrative goes.
    ///   - clock: Where the run reads the time from.
    public convenience init(
        chat: any AgentChatting,
        tools: [any AgentTool],
        budget: AgentBudget,
        logger: (any AgentLogger)? = nil,
        clock: any AgentClock = SystemAgentClock()
    ) {
        self.init(
            chat: chat,
            registry: AgentToolRegistry(tools: tools),
            configuration: AgentRunnerConfiguration(budget: budget),
            logger: logger,
            clock: clock
        )
    }

    /// Creates a runner with a custom registry, configuration and executor.
    ///
    /// - Parameters:
    ///   - chat: The conversation to drive.
    ///   - registry: The tools the model may call.
    ///   - configuration: How the run behaves.
    ///   - executor: What runs each tool call. Defaults to a ``DefaultAgentToolExecutor``.
    ///   - logger: Where the run's narrative goes.
    ///   - clock: Where the run reads the time from.
    public init(
        chat: any AgentChatting,
        registry: AgentToolRegistry,
        configuration: AgentRunnerConfiguration,
        executor: (any AgentToolExecuting)? = nil,
        logger: (any AgentLogger)? = nil,
        clock: any AgentClock = SystemAgentClock()
    ) {
        self.chat = chat
        self.registry = registry
        self.configuration = configuration
        self.executor = executor ?? DefaultAgentToolExecutor(
            registry: registry,
            logger: logger,
            loggedAnswerLength: configuration.loggedAnswerLength
        )
        self.logger = logger
        self.clock = clock
    }

    /// Runs the conversation until the model is done or a budget runs out.
    ///
    /// - Parameters:
    ///   - system: The system prompt.
    ///   - user: The user's request.
    /// - Returns: How the run ended.
    public func run(system: String, user: String) async -> AgentOutcome {
        Self.debugLog.debug("run(system:user:) started")
        defer { Self.debugLog.debug("run(system:user:) returned") }

        guard budget.maxTurns > 0 else {
            Self.debugLog.warning("Turn budget is zero, so the run cannot start")
            logger?.log(.started(tools: registry.names, budget: budget))
            return await finish(.turnBudgetSpent, turns: 0, toolCalls: 0)
        }

        logger?.log(.started(tools: registry.names, budget: budget))
        var state = AgentRunState(messages: [.system(system), .user(user)], started: clock.now)

        while state.turns < budget.maxTurns {
            if let reason = interruption(since: state.started) {
                return await finish(reason, turns: state.turns, toolCalls: state.toolCalls)
            }
            state.turns += 1
            Self.debugLog.debug("Starting turn \(state.turns)")
            logger?.log(.turnStarted(number: state.turns))
            await delegate?.agentRunner(self, willStartTurn: state.turns)
            await report(.thinking(turn: state.turns))

            let reply: AgentMessage
            do {
                reply = try await requestReply(for: state.messages)
            } catch {
                Self.debugLog.error("Turn \(state.turns) failed: \(error.localizedDescription, privacy: .public)")
                return await finish(
                    .failed(AgentFailureText.sentence(for: error)),
                    turns: state.turns,
                    toolCalls: state.toolCalls
                )
            }
            Self.debugLog.debug("Turn \(state.turns) replied with \(reply.toolCalls.count) tool calls")
            logger?.log(.turn(number: state.turns, usage: reply.usage, finishReason: reply.finishReason))
            state.messages.append(reply)
            await delegate?.agentRunner(self, didReceive: reply, turn: state.turns)

            guard reply.isRequestingTools else {
                Self.debugLog.debug("The model finished without asking for a tool")
                return await finish(.finished(reply.content), turns: state.turns, toolCalls: state.toolCalls)
            }

            let said = reply.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if !said.isEmpty {
                logger?.log(.said(said))
                await report(.said(said))
            }

            for call in reply.toolCalls {
                state.toolCalls += 1
                Self.debugLog.debug("Tool call \(state.toolCalls): \(call.name, privacy: .public)")
                await report(.toolRunning(tool: call.name, arguments: call.arguments))
                await delegate?.agentRunner(self, willRun: call)
                let answer = await executor.execute(call)
                state.messages.append(.tool(callID: call.id, content: answer))
                await delegate?.agentRunner(self, didRun: call, answer: answer)
                await report(.toolFinished(tool: call.name, callsSoFar: state.toolCalls, answer: answer))
                // Here as well as at the top of the turn: a turn that asked for
                // ten slow tools would otherwise run all ten, however long they
                // took and whoever had stopped it. A tool already running is
                // left to finish, because cutting one off mid-write is how half
                // a pin lands on the map.
                if configuration.checksInterruptionAfterEachTool, let reason = interruption(since: state.started) {
                    return await finish(reason, turns: state.turns, toolCalls: state.toolCalls)
                }
            }

            if state.toolCalls >= budget.maxToolCalls {
                Self.debugLog.debug("Tool budget spent after \(state.toolCalls) calls")
                return await finish(.toolBudgetSpent, turns: state.turns, toolCalls: state.toolCalls)
            }
        }
        Self.debugLog.debug("Turn budget spent after \(state.turns) turns")
        return await finish(.turnBudgetSpent, turns: state.turns, toolCalls: state.toolCalls)
    }

    /// Sends the history to the model, retrying as the configuration says.
    ///
    /// - Parameter messages: The conversation so far.
    /// - Returns: The model's reply.
    /// - Throws: The last error when every attempt has failed.
    private func requestReply(for messages: [AgentMessage]) async throws -> AgentMessage {
        var attempt = 0
        while true {
            attempt += 1
            do {
                return try await chat.respond(messages: messages, tools: registry.specs) { [onProgress] writing in
                    switch writing {
                    case let .thought(text): await onProgress?(.thought(text))
                    case let .prose(text): await onProgress?(.writing(text))
                    }
                }
            } catch {
                Self.debugLog.error("Attempt \(attempt) failed: \(error.localizedDescription, privacy: .public)")
                guard attempt < configuration.retryPolicy.maxAttempts else {
                    throw error
                }
                try await Task.sleep(for: configuration.retryPolicy.delay)
            }
        }
    }

    /// Reports progress to whoever is listening.
    ///
    /// - Parameter progress: What happened.
    private func report(_ progress: AgentProgress) async {
        await onProgress?(progress)
    }

    /// Why the run should do nothing further, if it should.
    ///
    /// - Parameter started: When the run started.
    /// - Returns: The reason to stop, or `nil` to carry on.
    private func interruption(since started: ContinuousClock.Instant) -> AgentStopReason? {
        if Task.isCancelled {
            Self.debugLog.debug("The run was cancelled")
            return .failed(AgentFailureText.stopped)
        }
        if clock.now - started >= budget.deadline {
            Self.debugLog.debug("The run reached its deadline")
            return .deadlineReached
        }
        return nil
    }

    /// Logs the end of the run and builds its outcome.
    ///
    /// - Parameters:
    ///   - reason: Why the run stopped.
    ///   - turns: How many turns it took.
    ///   - toolCalls: How many tool calls it made.
    /// - Returns: The outcome.
    private func finish(_ reason: AgentStopReason, turns: Int, toolCalls: Int) async -> AgentOutcome {
        logger?.log(.finished(reason, turns: turns, toolCalls: toolCalls))
        let outcome = AgentOutcome(reason: reason, turns: turns, toolCalls: toolCalls)
        await delegate?.agentRunner(self, didFinishWith: outcome)
        return outcome
    }
}

// MARK: - Run State

/// The mutable state of one run.
struct AgentRunState {
    /// The conversation so far.
    var messages: [AgentMessage]
    /// How many turns have been taken.
    var turns: Int = 0
    /// How many tool calls have been made.
    var toolCalls: Int = 0
    /// When the run started.
    let started: ContinuousClock.Instant
}
