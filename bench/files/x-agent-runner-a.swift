import Foundation

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
    /// A piece of the model's reasoning, as it is written. Only the streaming
    /// path reports these; on a reasoning model they are most of the wait, and
    /// without them a two-minute turn shows one unchanging line.
    case thought(String)
    /// A piece of the answer the model is composing. Reported for the same
    /// reason — most models are asked not to think out loud, so without this
    /// nothing moves at all for them — but kept apart from ``thought`` because
    /// these words arrive again whole as ``said`` or as the run's closing
    /// message, and a log holding both says everything twice.
    case writing(String)
    /// What the model wrote on its way to asking for a tool. Its closing words
    /// are not reported here: those are the stop reason, and repeating them
    /// would print the whole route into a progress list.
    case said(String)
    /// A tool is about to run, with the arguments it was called with.
    case toolRunning(tool: String, arguments: String)
    /// It answered, and with what.
    ///
    /// The answer rides along because a step's words are written before it
    /// exists, from the arguments alone, and one of the five tools makes a claim
    /// the arguments cannot settle: `add_site` reads "Added Zelova" whether the
    /// sink wrote a pin, found one already there, or refused the coordinate. See
    /// ``OutingStepText/outcome(for:arguments:answer:)``.
    case toolFinished(tool: String, callsSoFar: Int, answer: String)
}

/// Drives a tool-calling conversation to its end.
///
/// The whole loop is: send the history, append what came back, run whatever it
/// asked for, append one answer per call, go round again. It stops when the
/// model replies with words and no calls, or when one of the three budgets runs
/// out.
///
/// A class rather than a struct only so ``onProgress`` can be set after
/// construction, the way ``SurveyDetailModel``'s seams are.
public final class AgentRunner: @unchecked Sendable {
    private let chat: any AgentChatting
    private let tools: [String: any AgentTool]
    private let specs: [AgentToolSpec]
    private let budget: AgentBudget
    private let logger: (any AgentLogger)?
    private let clock: any AgentClock

    /// Called as the run moves. Awaited inline rather than fired into a task,
    /// so a feed reads in the order things actually happened.
    public var onProgress: (@Sendable (AgentProgress) async -> Void)?

    public init(
        chat: any AgentChatting,
        tools: [any AgentTool],
        budget: AgentBudget,
        logger: (any AgentLogger)? = nil,
        clock: any AgentClock = SystemAgentClock()
    ) {
        self.chat = chat
        self.tools = Dictionary(tools.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
        specs = tools.map(\.spec)
        self.budget = budget
        self.logger = logger
        self.clock = clock
    }

    public func run(system: String, user: String) async -> AgentOutcome {
        logger?.log(.started(tools: specs.map(\.name), budget: budget))
        var messages: [AgentMessage] = [.system(system), .user(user)]
        var turns = 0
        var toolCalls = 0
        let started = clock.now

        while turns < budget.maxTurns {
            if let reason = interruption(since: started) {
                return finish(reason, turns: turns, toolCalls: toolCalls)
            }
            turns += 1
            logger?.log(.turnStarted(number: turns))
            await onProgress?(.thinking(turn: turns))

            let reply: AgentMessage
            do {
                reply = try await chat.respond(messages: messages, tools: specs) { [onProgress] writing in
                    switch writing {
                    case let .thought(text): await onProgress?(.thought(text))
                    case let .prose(text): await onProgress?(.writing(text))
                    }
                }
            } catch {
                return finish(.failed(AgentFailureText.sentence(for: error)), turns: turns, toolCalls: toolCalls)
            }
            logger?.log(.turn(number: turns, usage: reply.usage, finishReason: reply.finishReason))
            messages.append(reply)

            guard reply.isRequestingTools else {
                return finish(.finished(reply.content), turns: turns, toolCalls: toolCalls)
            }

            let said = reply.content.trimmingCharacters(in: .whitespacesAndNewlines)
            if !said.isEmpty {
                logger?.log(.said(said))
                await onProgress?(.said(said))
            }

            for call in reply.toolCalls {
                toolCalls += 1
                await onProgress?(.toolRunning(tool: call.name, arguments: call.arguments))
                let answer = await answer(to: call)
                messages.append(.tool(callID: call.id, content: answer))
                await onProgress?(.toolFinished(tool: call.name, callsSoFar: toolCalls, answer: answer))
                // Here as well as at the top of the turn. Read only there, the
                // two bounded the conversation and not the work: a turn that
                // asked for ten slow tools ran all ten, however long they took
                // and whoever had stopped it. `read_link` has been measured at
                // 22 seconds on a large page, so nine in one turn is three
                // minutes nothing looked at. The check is after the call rather
                // than before it — a tool already running is left to finish,
                // because cutting one off mid-write is how half a pin lands on
                // the map.
                if let reason = interruption(since: started) {
                    return finish(reason, turns: turns, toolCalls: toolCalls)
                }
            }

            if toolCalls >= budget.maxToolCalls {
                return finish(.toolBudgetSpent, turns: turns, toolCalls: toolCalls)
            }
        }
        return finish(.turnBudgetSpent, turns: turns, toolCalls: toolCalls)
    }

    /// One call's answer. A tool that is not here is told so, in words the model
    /// can act on: naming the tools that do exist turns a dead end into a retry.
    private func answer(to call: AgentToolCall) async -> String {
        guard let tool = tools[call.name] else {
            logger?.log(.toolUnknown(name: call.name))
            let offered = specs.map(\.name).sorted().joined(separator: ", ")
            return #"{"error":"There is no tool called \#(call.name). The tools are: \#(offered)."}"#
        }
        logger?.log(.toolCalled(name: call.name, arguments: call.arguments))
        let result = await tool.run(ToolArguments(json: call.arguments))
        logger?.log(.toolAnswered(
            name: call.name, characters: result.count, answer: Self.forLog(result)
        ))
        return result
    }

    /// The longest a logged answer may be, ellipsis included. A search answers
    /// with a page of JSON, and a log nobody can scroll is a log nobody reads.
    static let loggedAnswerLength = 200

    /// The readable beginning of an answer: one line, cut to length.
    private static func forLog(_ answer: String) -> String {
        let line = answer.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        guard line.count > loggedAnswerLength else { return line }
        return String(line.prefix(loggedAnswerLength - 1)) + "…"
    }

    /// Why the run should do nothing further, if it should: the two questions
    /// asked at the top of every turn and again after every tool call.
    ///
    /// Cancellation first, and reported as a failure carrying the sentence a
    /// cancelled request already carries rather than as a case of its own,
    /// because nothing ever shows it: ``OutingRunModel/cancel()`` has put the
    /// banner back to idle before this returns, and every write-back is gated on
    /// the run still being one somebody wants.
    private func interruption(since started: ContinuousClock.Instant) -> AgentStopReason? {
        if Task.isCancelled { return .failed(AgentFailureText.stopped) }
        if clock.now - started >= budget.deadline { return .deadlineReached }
        return nil
    }

    private func finish(_ reason: AgentStopReason, turns: Int, toolCalls: Int) -> AgentOutcome {
        logger?.log(.finished(reason, turns: turns, toolCalls: toolCalls))
        return AgentOutcome(reason: reason, turns: turns, toolCalls: toolCalls)
    }
}
