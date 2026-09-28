using System.Globalization;
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

    private const int MaxCustomerIdWidth = 12;

    public static List<Order> Load(string path)
    {
        var text = File.ReadAllText(path);
        var orders = JsonSerializer.Deserialize<List<Order>>(text, Json);
        if (orders == null)
        {
            return new List<Order>();
        }
        return orders;
    }

    // public static List<Order> LoadCsv(string path)
    // {
    //     var orders = new List<Order>();
    //     foreach (var row in File.ReadLines(path).Skip(1))
    //     {
    //         var cells = row.Split(',');
    //         orders.Add(new Order(cells[0], cells[1], DateOnly.Parse(cells[2]), cells[3], new List<OrderLine>()));
    //     }
    //     return orders;
    // }

    /// <summary>
    /// What is wrong with the export, worth fixing before anyone trusts the totals.
    /// </summary>
    public static IEnumerable<string> Problems(IReadOnlyList<Order> orders)
    {
        var problems = new List<string>();

        var counts = new Dictionary<string, int>();
        var idsInOrder = new List<string>();
        foreach (var order in orders)
        {
            if (counts.ContainsKey(order.Id))
            {
                counts[order.Id] = counts[order.Id] + 1;
            }
            else
            {
                counts[order.Id] = 1;
                idsInOrder.Add(order.Id);
            }
        }
        foreach (var id in idsInOrder)
        {
            var count = counts[id];
            if (count > 1)
            {
                problems.Add($"order {id} appears {count} times");
            }
        }

        foreach (var order in orders)
        {
            if (order.Lines.Count == 0)
            {
                problems.Add($"order {order.Id} has no lines");
            }
            foreach (var line in order.Lines)
            {
                if (line.Quantity <= 0)
                {
                    var message = $"order {order.Id}: {line.Sku} has quantity {line.Quantity} at {line.UnitPrice}";
                    problems.Add(message);
                    continue;
                }
                if (line.UnitPrice < 0)
                {
                    var message = $"order {order.Id}: {line.Sku} has quantity {line.Quantity} at {line.UnitPrice}";
                    problems.Add(message);
                }
            }
        }

        return problems;
    }

    public static List<CustomerSummary> ByCustomer(IEnumerable<Order> orders)
    {
        var ordersByCustomer = new Dictionary<string, List<Order>>();
        var customersInOrder = new List<string>();
        foreach (var order in orders)
        {
            // Cancelled orders never shipped and refunded ones were paid back, so neither is spend.
            var status = order.Status;
            bool countsAsSpend;
            if (string.Equals(status, "cancelled", StringComparison.OrdinalIgnoreCase))
            {
                countsAsSpend = false;
            }
            else if (string.Equals(status, "refunded", StringComparison.OrdinalIgnoreCase))
            {
                countsAsSpend = false;
            }
            else
            {
                countsAsSpend = true;
            }

            if (!countsAsSpend)
            {
                continue;
            }

            if (!ordersByCustomer.ContainsKey(order.CustomerId))
            {
                ordersByCustomer[order.CustomerId] = new List<Order>();
                customersInOrder.Add(order.CustomerId);
            }
            ordersByCustomer[order.CustomerId].Add(order);
        }

        var summaries = new List<CustomerSummary>();
        foreach (var customerId in customersInOrder)
        {
            var customerOrders = ordersByCustomer[customerId];
            var orderCount = 0;
            decimal spent = 0;
            var lastOrder = DateOnly.MinValue;
            foreach (var order in customerOrders)
            {
                orderCount = orderCount + 1;
                spent = spent + CalculateOrderTotal(order);
                if (order.PlacedOn > lastOrder)
                {
                    lastOrder = order.PlacedOn;
                }
            }
            var summary = new CustomerSummary(customerId, orderCount, spent, lastOrder);
            summaries.Add(summary);
        }

        summaries.Sort((left, right) =>
        {
            var bySpent = right.Spent.CompareTo(left.Spent);
            if (bySpent != 0)
            {
                return bySpent;
            }
            return string.CompareOrdinal(left.CustomerId, right.CustomerId);
        });
        return summaries;
    }

    private static decimal CalculateOrderTotal(Order order)
    {
        decimal total = 0;
        foreach (var line in order.Lines)
        {
            var lineTotal = line.Quantity * line.UnitPrice;
            total = total + lineTotal;
        }
        return total;
    }

    private static string FormatCurrency(decimal amount)
    {
        return amount.ToString("N2", CultureInfo.CurrentCulture);
    }
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
        // Console.WriteLine($"Loaded {orders.Count} orders from {args[0]}");
        foreach (var problem in OrderReport.Problems(orders))
            Console.Error.WriteLine($"warning: {problem}");

        Console.WriteLine($"{"customer",-12} {"orders",6} {"spent",12} {"last order",12}");
        foreach (var summary in OrderReport.ByCustomer(orders))
            Console.WriteLine($"{summary.CustomerId,-12} {summary.Orders,6} {summary.Spent,12:N2} {summary.LastOrder,12:yyyy-MM-dd}");
        return 0;
    }
}
