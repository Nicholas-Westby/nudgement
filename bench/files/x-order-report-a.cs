using System.Text.Json;

namespace Orders;

public sealed record OrderLine(string Sku, int Quantity, decimal UnitPrice);

public sealed record Order(string Id, string CustomerId, DateOnly PlacedOn, string Status, List<OrderLine> Lines)
{
    public decimal Total => Lines.Sum(line => line.Quantity * line.UnitPrice);
}

public sealed record CustomerSummary(string CustomerId, int Orders, decimal Spent, DateOnly LastOrder);

/// <summary>
/// Reads the shop's orders export and summarises what each customer has spent.
/// </summary>
public static class OrderReport
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // Cancelled orders never shipped and refunded ones were paid back, so neither is spend.
    private static readonly HashSet<string> NotSpend = new(StringComparer.OrdinalIgnoreCase) { "cancelled", "refunded" };

    public static List<Order> Load(string path) =>
        JsonSerializer.Deserialize<List<Order>>(File.ReadAllText(path), Json) ?? [];

    /// <summary>
    /// What is wrong with the export, worth fixing before anyone trusts the totals.
    /// </summary>
    public static IEnumerable<string> Problems(IReadOnlyList<Order> orders)
    {
        var repeated = orders.GroupBy(order => order.Id).Where(group => group.Count() > 1);
        foreach (var group in repeated)
            yield return $"order {group.Key} appears {group.Count()} times";

        foreach (var order in orders)
        {
            if (order.Lines.Count == 0)
                yield return $"order {order.Id} has no lines";
            foreach (var line in order.Lines.Where(line => line.Quantity <= 0 || line.UnitPrice < 0))
                yield return $"order {order.Id}: {line.Sku} has quantity {line.Quantity} at {line.UnitPrice}";
        }
    }

    public static List<CustomerSummary> ByCustomer(IEnumerable<Order> orders) =>
        orders
            .Where(order => !NotSpend.Contains(order.Status))
            .GroupBy(order => order.CustomerId)
            .Select(group => new CustomerSummary(
                group.Key,
                group.Count(),
                group.Sum(order => order.Total),
                group.Max(order => order.PlacedOn)))
            .OrderByDescending(summary => summary.Spent)
            .ThenBy(summary => summary.CustomerId, StringComparer.Ordinal)
            .ToList();
}

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: order-report <orders.json>");
            return 64;
        }

        var orders = OrderReport.Load(args[0]);
        foreach (var problem in OrderReport.Problems(orders))
            Console.Error.WriteLine($"warning: {problem}");

        Console.WriteLine($"{"customer",-12} {"orders",6} {"spent",12} {"last order",12}");
        foreach (var summary in OrderReport.ByCustomer(orders))
            Console.WriteLine($"{summary.CustomerId,-12} {summary.Orders,6} {summary.Spent,12:N2} {summary.LastOrder,12:yyyy-MM-dd}");
        return 0;
    }
}
