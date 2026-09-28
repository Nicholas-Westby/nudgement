using System.Diagnostics;

namespace Uptime;

/// <summary>
/// Polls a set of URLs and prints a line whenever one goes down or comes back.
/// </summary>
/// <remarks>
/// Only changes are printed, so a quiet terminal means nothing has changed. Any
/// answer below 500 counts as up: a 404 or a 401 still proves the server is
/// there and answering, which is the only question being asked.
/// </remarks>
public sealed class UptimeMonitor(HttpClient http, TimeSpan timeout, TextWriter output)
{
    private readonly Dictionary<Uri, bool> _wasUp = [];

    public async Task RunAsync(IReadOnlyList<Uri> targets, TimeSpan interval, CancellationToken cancel)
    {
        using var timer = new PeriodicTimer(interval);
        do
        {
            var results = await Task.WhenAll(targets.Select(target => CheckAsync(target, cancel)));
            foreach (var result in results)
                Report(result);
        }
        while (await timer.WaitForNextTickAsync(cancel));
    }

    public async Task<CheckResult> CheckAsync(Uri target, CancellationToken cancel)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        deadline.CancelAfter(timeout);
        var clock = Stopwatch.StartNew();
        try
        {
            using var response = await http.GetAsync(target, HttpCompletionOption.ResponseHeadersRead, deadline.Token);
            var status = (int)response.StatusCode;
            return new CheckResult(target, status < 500, status.ToString(), clock.Elapsed);
        }
        catch (OperationCanceledException) when (!cancel.IsCancellationRequested)
        {
            // Our own deadline fired rather than the caller's: too slow to count as up.
            return new CheckResult(target, false, "timed out", clock.Elapsed);
        }
        catch (HttpRequestException error)
        {
            return new CheckResult(target, false, error.Message, clock.Elapsed);
        }
    }

    private void Report(CheckResult result)
    {
        if (_wasUp.TryGetValue(result.Target, out var wasUp) && wasUp == result.IsUp)
            return;
        _wasUp[result.Target] = result.IsUp;
        var state = result.IsUp ? "UP  " : "DOWN";
        output.WriteLine($"{DateTime.Now:HH:mm:ss} {state} {result.Target} ({result.Detail}, {result.Elapsed.TotalMilliseconds:F0} ms)");
    }
}

public sealed record CheckResult(Uri Target, bool IsUp, string Detail, TimeSpan Elapsed);

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var notUrl = args.FirstOrDefault(arg => !Uri.TryCreate(arg, UriKind.Absolute, out _));
        if (args.Length == 0 || notUrl is not null)
        {
            Console.Error.WriteLine(notUrl is null ? "usage: uptime <url>..." : $"not an absolute URL: {notUrl}");
            return 64;
        }

        using var cancel = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cancel.Cancel();
        };

        using var http = new HttpClient();
        var monitor = new UptimeMonitor(http, TimeSpan.FromSeconds(10), Console.Out);
        try
        {
            await monitor.RunAsync(args.Select(arg => new Uri(arg)).ToList(), TimeSpan.FromSeconds(30), cancel.Token);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            // Ctrl-C: stop without a stack trace.
        }
        return 0;
    }
}
