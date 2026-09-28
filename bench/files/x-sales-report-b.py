#!/usr/bin/env python3
"""Monthly revenue per region from an orders export.

    sales_report.py orders.csv > report.csv
    sales_report.py orders.csv --since 2024-01

The export has one row per order line: order_id, date (YYYY-MM-DD), region,
quantity, unit_price. Refunds arrive as negative quantities dated the day of
the refund, so they net off in the month they were paid back, which is what
the accounts show too.
"""

import argparse
import csv
import sys
from decimal import Decimal

DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def is_leap_year(year):
    if year % 400 == 0:
        return True
    if year % 100 == 0:
        return False
    if year % 4 == 0:
        return True
    return False


def days_in_month(year, month):
    if month == 2 and is_leap_year(year):
        return 29
    return DAYS_IN_MONTH[month - 1]


def zero_pad(number, width):
    text = str(number)
    while len(text) < width:
        text = "0" + text
    return text


def parse_date(text):
    """Parse a YYYY-MM-DD date into (year, month, day)."""
    parts = text.split("-")
    if len(parts) != 3:
        raise ValueError(f"Invalid date: {text!r}")
    year_text, month_text, day_text = parts
    if len(year_text) != 4 or len(month_text) != 2 or len(day_text) != 2:
        raise ValueError(f"Invalid date: {text!r}")
    if not (year_text.isdigit() and month_text.isdigit() and day_text.isdigit()):
        raise ValueError(f"Invalid date: {text!r}")
    year = int(year_text)
    month = int(month_text)
    day = int(day_text)
    if year < 1:
        raise ValueError(f"Invalid year in date: {text!r}")
    if month < 1 or month > 12:
        raise ValueError(f"Invalid month in date: {text!r}")
    if day < 1 or day > days_in_month(year, month):
        raise ValueError(f"Invalid day in date: {text!r}")
    return year, month, day


def month_key(text):
    year, month, _day = parse_date(text)
    return zero_pad(year, 4) + "-" + zero_pad(month, 2)


def unique_sorted(values):
    unique = []
    for value in values:
        if value not in unique:
            unique.append(value)
    unique.sort()
    return unique


def monthly_revenue(rows, since=None):
    """{(region, "YYYY-MM"): revenue} for every month from `since` on."""
    revenue = {}
    for row in rows:
        month = month_key(row["date"])
        if since is not None and since != "":
            if month < since:
                continue
        region = row["region"].strip()
        quantity = int(row["quantity"])
        unit_price = Decimal(row["unit_price"])
        # Decimal, not float: a column of prices summed as floats is off by a
        # cent often enough that the totals row stops matching the invoices.
        line_total = quantity * unit_price
        key = (region, month)
        if key not in revenue:
            revenue[key] = Decimal(0)
        revenue[key] = revenue[key] + line_total
    return revenue


def write_report(revenue, out):
    """One row per region and one column per month, with totals both ways."""
    all_regions = []
    all_months = []
    for key in revenue:
        region = key[0]
        month = key[1]
        all_regions.append(region)
        all_months.append(month)
    regions = unique_sorted(all_regions)
    months = unique_sorted(all_months)

    writer = csv.writer(out)
    header = ["region"]
    for month in months:
        header.append(month)
    header.append("total")
    writer.writerow(header)

    for region in regions:
        row = [region]
        region_total = Decimal(0)
        for month in months:
            key = (region, month)
            if key in revenue:
                amount = revenue[key]
            else:
                amount = Decimal(0)
            row.append(f"{amount:.2f}")
            region_total = region_total + amount
        row.append(f"{region_total:.2f}")
        writer.writerow(row)

    total_row = ["total"]
    grand_total = Decimal(0)
    for month in months:
        month_total = Decimal(0)
        for region in regions:
            key = (region, month)
            if key in revenue:
                month_total = month_total + revenue[key]
        total_row.append(f"{month_total:.2f}")
        grand_total = grand_total + month_total
    total_row.append(f"{grand_total:.2f}")
    writer.writerow(total_row)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Monthly revenue per region.")
    parser.add_argument("orders", help="the orders CSV export")
    parser.add_argument("--since", metavar="YYYY-MM", help="leave out months before this one")
    args = parser.parse_args(argv)

    with open(args.orders, newline="") as handle:
        revenue = monthly_revenue(csv.DictReader(handle), args.since)
    write_report(revenue, sys.stdout)


if __name__ == "__main__":
    main()
