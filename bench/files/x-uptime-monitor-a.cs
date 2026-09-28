using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging;

namespace Uptime;

#region Options

/// <summary>
/// Options that control how the <see cref="UptimeMonitor"/> behaves.
/// </summary>
public sealed class UptimeMonitorOptions
{
    /// <summary>
    /// Gets or sets the interval between check cycles.
    /// </summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Gets or sets the timeout for a single check.
    /// </summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Gets or sets the lowest HTTP status code that counts as down.
    /// </summary>
    public int UnhealthyStatusCodeThreshold { get; set; } = 500;

    /// <summary>
    /// Gets or sets how many times a failed check is retried.
    /// </summary>
    public int RetryCount { get; set; } = 0;

    /// <summary>
    /// Gets or sets the delay between retries.
    /// </summary>
    public TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Gets or sets the most checks run at once. Zero means no limit.
    /// </summary>
    public int MaxConcurrency { get; set; } = 0;

    /// <summary>
    /// Gets or sets a value indicating whether results that did not change are reported too.
    /// </summary>
    public bool ReportUnchanged { get; set; } = false;

    /// <summary>
    /// Gets or sets the path of a CSV file every result is appended to, if any.
    /// </summary>
    public string? HistoryFilePath { get; set; }

    /// <summary>
    /// Gets or sets a URL that is sent a JSON alert whenever a target changes state, if any.
    /// </summary>
    public Uri? AlertWebhookUrl { get; set; }

    /// <summary>
    /// Creates options from the <c>UPTIME_*</c> environment variables, falling back to the defaults.
    /// </summary>
    /// <returns>The options.</returns>
    public static UptimeMonitorOptions FromEnvironment()
    {
        var options = new UptimeMonitorOptions();
        if (int.TryParse(Environment.GetEnvironmentVariable("UPTIME_RETRY_COUNT"), out var retryCount))
            options.RetryCount = retryCount;
        if (int.TryParse(Environment.GetEnvironmentVariable("UPTIME_MAX_CONCURRENCY"), out var maxConcurrency))
            options.MaxConcurrency = maxConcurrency;
        if (Environment.GetEnvironmentVariable("UPTIME_HISTORY_FILE") is { Length: > 0 } historyFile)
            options.HistoryFilePath = historyFile;
        if (Uri.TryCreate(Environment.GetEnvironmentVariable("UPTIME_ALERT_WEBHOOK"), UriKind.Absolute, out var webhook))
            options.AlertWebhookUrl = webhook;
        return options;
    }

    /// <summary>
    /// Validates the options.
    /// </summary>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when an option is out of range.</exception>
    public void Validate()
    {
        if (Interval <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(Interval), "Interval must be positive.");
        if (Timeout <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(Timeout), "Timeout must be positive.");
        if (RetryCount < 0)
            throw new ArgumentOutOfRangeException(nameof(RetryCount), "RetryCount cannot be negative.");
        if (MaxConcurrency < 0)
            throw new ArgumentOutOfRangeException(nameof(MaxConcurrency), "MaxConcurrency cannot be negative.");
    }
}

#endregion

#region Models

/// <summary>
/// The health of a target.
/// </summary>
public enum HealthStatus
{
    /// <summary>The target has not been checked yet.</summary>
    Unknown,

    /// <summary>The target is up.</summary>
    Up,

    /// <summary>The target is down.</summary>
    Down,
}

/// <summary>
/// The result of checking a single target.
/// </summary>
public sealed class HealthCheckResult
{
    /// <summary>Gets the target that was checked.</summary>
    public required Uri Target { get; init; }

    /// <summary>Gets the health of the target.</summary>
    public required HealthStatus Status { get; init; }

    /// <summary>Gets the HTTP status code, if a response arrived.</summary>
    public int? StatusCode { get; init; }

    /// <summary>Gets the error message, if the check failed.</summary>
    public string? ErrorMessage { get; init; }

    /// <summary>Gets how long the check took.</summary>
    public TimeSpan Elapsed { get; init; }

    /// <summary>Gets when the check finished.</summary>
    public DateTimeOffset CheckedAt { get; init; }

    /// <summary>Gets a value indicating whether the target is up.</summary>
    public bool IsUp => Status == HealthStatus.Up;

    /// <summary>Gets a short description of the result.</summary>
    public string Detail => StatusCode?.ToString(CultureInfo.InvariantCulture) ?? ErrorMessage ?? "unknown";
}

/// <summary>
/// A change in a target's health.
/// </summary>
/// <param name="Target">The target.</param>
/// <param name="Previous">The health before the check.</param>
/// <param name="Current">The health after the check.</param>
/// <param name="Result">The result of the check.</param>
public sealed record StatusChange(Uri Target, HealthStatus Previous, HealthStatus Current, HealthCheckResult Result);

#endregion

#region Exceptions

/// <summary>
/// The base class for errors raised by the uptime monitor.
/// </summary>
public class UptimeMonitorException : Exception
{
    public UptimeMonitorException(string message) : base(message) { }

    public UptimeMonitorException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Raised when a health check fails.
/// </summary>
public class HealthCheckException : UptimeMonitorException
{
    public HealthCheckException(string message) : base(message) { }

    public HealthCheckException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Raised when a health check does not finish within the timeout.
/// </summary>
public sealed class HealthCheckTimeoutException : HealthCheckException
{
    public HealthCheckTimeoutException(string message, Exception innerException) : base(message, innerException) { }
}

#endregion

#region Abstractions

/// <summary>
/// Provides the current time.
/// </summary>
public interface ISystemClock
{
    /// <summary>Gets the current time.</summary>
    DateTimeOffset Now { get; }
}

/// <summary>
/// Checks the health of a single target.
/// </summary>
public interface IHealthChecker
{
    /// <summary>
    /// Checks the health of a target.
    /// </summary>
    /// <param name="target">The target to check.</param>
    /// <param name="cancellationToken">A token that cancels the check.</param>
    /// <returns>The result of the check.</returns>
    Task<HealthCheckResult> CheckAsync(Uri target, CancellationToken cancellationToken);
}

/// <summary>
/// Creates health checkers.
/// </summary>
public interface IHealthCheckerFactory
{
    /// <summary>
    /// Creates a health checker for the given options.
    /// </summary>
    /// <param name="options">The options.</param>
    /// <returns>A health checker.</returns>
    IHealthChecker Create(UptimeMonitorOptions options);
}

/// <summary>
/// Remembers the last known health of each target.
/// </summary>
public interface IStatusStore
{
    /// <summary>Gets the last known health of a target.</summary>
    HealthStatus Get(Uri target);

    /// <summary>Sets the last known health of a target.</summary>
    void Set(Uri target, HealthStatus status);
}

/// <summary>
/// Reports changes in a target's health.
/// </summary>
public interface IStatusReporter
{
    /// <summary>Reports a change.</summary>
    void Report(StatusChange change);
}

/// <summary>
/// Monitors a set of targets.
/// </summary>
public interface IUptimeMonitor
{
    /// <summary>
    /// Monitors the targets until cancelled.
    /// </summary>
    Task RunAsync(IReadOnlyList<Uri> targets, CancellationToken cancellationToken);
}

#endregion

#region Implementations

/// <summary>
/// An <see cref="ISystemClock"/> that reads the system clock.
/// </summary>
public sealed class SystemClock : ISystemClock
{
    /// <inheritdoc />
    public DateTimeOffset Now => DateTimeOffset.Now;
}

/// <summary>
/// An <see cref="IStatusStore"/> that keeps the health of each target in memory.
/// </summary>
public sealed class InMemoryStatusStore : IStatusStore
{
    private readonly Dictionary<Uri, HealthStatus> _statuses = new();

    /// <inheritdoc />
    public HealthStatus Get(Uri target)
    {
        ArgumentNullException.ThrowIfNull(target);
        return _statuses.TryGetValue(target, out var status) ? status : HealthStatus.Unknown;
    }

    /// <inheritdoc />
    public void Set(Uri target, HealthStatus status)
    {
        ArgumentNullException.ThrowIfNull(target);
        _statuses[target] = status;
    }
}

/// <summary>
/// An <see cref="IStatusReporter"/> that writes one line per change.
/// </summary>
public sealed class ConsoleStatusReporter : IStatusReporter
{
    private readonly TextWriter _output;
    private readonly ISystemClock _clock;

    public ConsoleStatusReporter(TextWriter output, ISystemClock clock)
    {
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(clock);
        _output = output;
        _clock = clock;
    }

    /// <inheritdoc />
    public void Report(StatusChange change)
    {
        ArgumentNullException.ThrowIfNull(change);
        var state = change.Current == HealthStatus.Up ? "UP  " : "DOWN";
        var elapsed = change.Result.Elapsed.TotalMilliseconds;
        _output.WriteLine($"{_clock.Now:HH:mm:ss} {state} {change.Target} ({change.Result.Detail}, {elapsed:F0} ms)");
    }
}

/// <summary>
/// An <see cref="IHealthChecker"/> that sends an HTTP GET to the target.
/// </summary>
public sealed class HttpHealthChecker : IHealthChecker
{
    private readonly HttpClient _httpClient;
    private readonly UptimeMonitorOptions _options;
    private readonly ISystemClock _clock;
    private readonly ILogger<HttpHealthChecker> _logger;

    public HttpHealthChecker(HttpClient httpClient, UptimeMonitorOptions options, ISystemClock clock, ILogger<HttpHealthChecker> logger)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(logger);
        _httpClient = httpClient;
        _options = options;
        _clock = clock;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<HealthCheckResult> CheckAsync(Uri target, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(target);
        _logger.LogDebug("Checking {Target}", target);

        var attempt = 0;
        while (true)
        {
            attempt++;
            var result = await CheckOnceAsync(target, cancellationToken);
            if (result.IsUp || attempt > _options.RetryCount)
            {
                _logger.LogDebug("{Target} is {Status} after {Attempts} attempt(s)", target, result.Status, attempt);
                return result;
            }

            _logger.LogInformation("Check of {Target} failed, retrying in {Delay}", target, _options.RetryDelay);
            await Task.Delay(_options.RetryDelay, cancellationToken);
        }
    }

    private async Task<HealthCheckResult> CheckOnceAsync(Uri target, CancellationToken cancellationToken)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(_options.Timeout);
        var stopwatch = Stopwatch.StartNew();
        try
        {
            try
            {
                using var response = await _httpClient.GetAsync(target, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
                var statusCode = (int)response.StatusCode;
                _logger.LogDebug("{Target} answered {StatusCode} in {Elapsed} ms", target, statusCode, stopwatch.ElapsedMilliseconds);
                return new HealthCheckResult
                {
                    Target = target,
                    Status = statusCode < _options.UnhealthyStatusCodeThreshold ? HealthStatus.Up : HealthStatus.Down,
                    StatusCode = statusCode,
                    Elapsed = stopwatch.Elapsed,
                    CheckedAt = _clock.Now,
                };
            }
            catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
            {
                throw new HealthCheckTimeoutException("timed out", ex);
            }
            catch (HttpRequestException ex)
            {
                throw new HealthCheckException(ex.Message, ex);
            }
        }
        catch (HealthCheckException ex)
        {
            _logger.LogWarning(ex, "Health check for {Target} failed", target);
            return new HealthCheckResult
            {
                Target = target,
                Status = HealthStatus.Down,
                ErrorMessage = ex.Message,
                Elapsed = stopwatch.Elapsed,
                CheckedAt = _clock.Now,
            };
        }
    }
}

/// <summary>
/// Creates <see cref="HttpHealthChecker"/> instances.
/// </summary>
public sealed class HealthCheckerFactory : IHealthCheckerFactory
{
    private readonly HttpClient _httpClient;
    private readonly ISystemClock _clock;
    private readonly ILoggerFactory _loggerFactory;

    public HealthCheckerFactory(HttpClient httpClient, ISystemClock clock, ILoggerFactory loggerFactory)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(loggerFactory);
        _httpClient = httpClient;
        _clock = clock;
        _loggerFactory = loggerFactory;
    }

    /// <inheritdoc />
    public IHealthChecker Create(UptimeMonitorOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return new HttpHealthChecker(_httpClient, options, _clock, _loggerFactory.CreateLogger<HttpHealthChecker>());
    }
}

/// <summary>
/// Appends every check result to a CSV file.
/// </summary>
public sealed class CsvHistoryWriter
{
    private readonly string _path;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public CsvHistoryWriter(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        _path = path;
    }

    /// <summary>
    /// Appends a result to the file, writing a header first when the file is new.
    /// </summary>
    public async Task AppendAsync(HealthCheckResult result, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_path))
                await File.WriteAllTextAsync(_path, "checked_at,target,status,detail,elapsed_ms" + Environment.NewLine, cancellationToken);
            var line = string.Join(',',
                result.CheckedAt.ToString("O", CultureInfo.InvariantCulture),
                result.Target,
                result.Status,
                "\"" + result.Detail.Replace("\"", "\"\"") + "\"",
                result.Elapsed.TotalMilliseconds.ToString("F0", CultureInfo.InvariantCulture));
            await File.AppendAllTextAsync(_path, line + Environment.NewLine, cancellationToken);
        }
        finally
        {
            _lock.Release();
        }
    }
}

/// <summary>
/// Posts a JSON alert to a webhook whenever a target changes state.
/// </summary>
public sealed class WebhookAlertNotifier
{
    private readonly HttpClient _httpClient;
    private readonly Uri _webhookUrl;

    public WebhookAlertNotifier(HttpClient httpClient, Uri webhookUrl)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(webhookUrl);
        _httpClient = httpClient;
        _webhookUrl = webhookUrl;
    }

    /// <summary>
    /// Sends an alert for a change.
    /// </summary>
    public async Task SendAsync(StatusChange change, CancellationToken cancellationToken)
    {
        var payload = new
        {
            target = change.Target.ToString(),
            previous = change.Previous.ToString(),
            current = change.Current.ToString(),
            detail = change.Result.Detail,
            checkedAt = change.Result.CheckedAt,
        };
        using var response = await _httpClient.PostAsJsonAsync(_webhookUrl, payload, cancellationToken);
        response.EnsureSuccessStatusCode();
    }
}

/// <summary>
/// Polls a set of targets and reports whenever one goes down or comes back.
/// </summary>
public sealed class UptimeMonitor : IUptimeMonitor
{
    private readonly UptimeMonitorOptions _options;
    private readonly IHealthChecker _checker;
    private readonly IStatusStore _store;
    private readonly IStatusReporter _reporter;
    private readonly ILogger<UptimeMonitor> _logger;
    private readonly CsvHistoryWriter? _history;
    private readonly WebhookAlertNotifier? _alerts;

    public UptimeMonitor(
        UptimeMonitorOptions options,
        IHealthChecker checker,
        IStatusStore store,
        IStatusReporter reporter,
        ILogger<UptimeMonitor> logger,
        CsvHistoryWriter? history = null,
        WebhookAlertNotifier? alerts = null)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(checker);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(reporter);
        ArgumentNullException.ThrowIfNull(logger);
        options.Validate();
        _options = options;
        _checker = checker;
        _store = store;
        _reporter = reporter;
        _logger = logger;
        _history = history;
        _alerts = alerts;
    }

    /// <inheritdoc />
    public async Task RunAsync(IReadOnlyList<Uri> targets, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(targets);
        if (targets.Count == 0)
            throw new ArgumentException("At least one target is required.", nameof(targets));

        _logger.LogInformation("Starting uptime monitor for {Count} target(s)", targets.Count);
        using var timer = new PeriodicTimer(_options.Interval);
        try
        {
            do
            {
                _logger.LogDebug("Starting check cycle");
                var results = await CheckAllAsync(targets, cancellationToken);
                foreach (var result in results)
                {
                    await ProcessResultAsync(result, cancellationToken);
                }
                _logger.LogDebug("Check cycle complete");
            }
            while (await timer.WaitForNextTickAsync(cancellationToken));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "The uptime monitor failed");
            throw;
        }
        finally
        {
            _logger.LogInformation("Uptime monitor stopped");
        }
    }

    private async Task<HealthCheckResult[]> CheckAllAsync(IReadOnlyList<Uri> targets, CancellationToken cancellationToken)
    {
        if (_options.MaxConcurrency <= 0)
            return await Task.WhenAll(targets.Select(target => _checker.CheckAsync(target, cancellationToken)));

        using var gate = new SemaphoreSlim(_options.MaxConcurrency);
        return await Task.WhenAll(targets.Select(async target =>
        {
            await gate.WaitAsync(cancellationToken);
            try
            {
                return await _checker.CheckAsync(target, cancellationToken);
            }
            finally
            {
                gate.Release();
            }
        }));
    }

    private async Task ProcessResultAsync(HealthCheckResult result, CancellationToken cancellationToken)
    {
        var previous = _store.Get(result.Target);
        _store.Set(result.Target, result.Status);

        if (_history is not null)
            await _history.AppendAsync(result, cancellationToken);

        if (previous == result.Status && !_options.ReportUnchanged)
        {
            _logger.LogDebug("{Target} unchanged ({Status})", result.Target, result.Status);
            return;
        }

        var change = new StatusChange(result.Target, previous, result.Status, result);
        _reporter.Report(change);

        if (_alerts is not null)
            await _alerts.SendAsync(change, cancellationToken);
    }
}

#endregion

#region Entry point

public static class Program
{
    /// <summary>The exit code for success.</summary>
    private const int ExitSuccess = 0;

    /// <summary>The exit code for invalid usage.</summary>
    private const int ExitUsage = 64;

    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("usage: uptime <url>...");
            return ExitUsage;
        }

        var targets = new List<Uri>();
        foreach (var arg in args)
        {
            if (!Uri.TryCreate(arg, UriKind.Absolute, out var uri))
            {
                Console.Error.WriteLine($"not an absolute URL: {arg}");
                return ExitUsage;
            }
            targets.Add(uri);
        }

        var options = UptimeMonitorOptions.FromEnvironment();
        options.Validate();

        // Status changes are the output, so the logger only speaks up for errors.
        using var loggerFactory = LoggerFactory.Create(builder => builder
            .AddSimpleConsole(console => console.SingleLine = true)
            .SetMinimumLevel(LogLevel.Error));

        using var cancellationSource = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cancellationSource.Cancel();
        };

        using var httpClient = new HttpClient();
        var clock = new SystemClock();
        var factory = new HealthCheckerFactory(httpClient, clock, loggerFactory);
        var monitor = new UptimeMonitor(
            options,
            factory.Create(options),
            new InMemoryStatusStore(),
            new ConsoleStatusReporter(Console.Out, clock),
            loggerFactory.CreateLogger<UptimeMonitor>(),
            options.HistoryFilePath is null ? null : new CsvHistoryWriter(options.HistoryFilePath),
            options.AlertWebhookUrl is null ? null : new WebhookAlertNotifier(httpClient, options.AlertWebhookUrl));

        try
        {
            await monitor.RunAsync(targets, cancellationSource.Token);
        }
        catch (OperationCanceledException) when (cancellationSource.IsCancellationRequested)
        {
            // Ctrl-C: stop without a stack trace.
        }

        return ExitSuccess;
    }
}

#endregion
