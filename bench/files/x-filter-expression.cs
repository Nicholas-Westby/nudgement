using System.Globalization;
using System.Text;

namespace Filters;

/// <summary>
/// A filter typed into the issue list's search box, parsed once and then run
/// against every record.
/// </summary>
/// <remarks>
/// <code>
///   status = "open" and (priority >= 2 or not assignee)
///   title ~ "crash" and not label = "wontfix"
/// </code>
/// Grammar, lowest precedence first:
/// <code>
///   or         := and ("or" and)*
///   and        := unary ("and" unary)*
///   unary      := "not" unary | primary
///   primary    := "(" or ")" | field (op value)?
///   op         := = | != | &lt; | &lt;= | &gt; | &gt;= | ~
///   value      := "string" | number | true | false
/// </code>
/// A bare field is true when the record has it and it is not empty, false or
/// null. Hand-written rather than a pile of regular expressions because nesting
/// and precedence are the point, and because a syntax error has to say where it
/// is: the person who made it is looking at the box.
/// </remarks>
public abstract record Filter
{
    public abstract bool Matches(IReadOnlyDictionary<string, object?> record);

    public static Filter Parse(string text) => new Parser(Lexer.Tokenize(text)).ParseAll();
}

public sealed record AnyOf(Filter Left, Filter Right) : Filter
{
    public override bool Matches(IReadOnlyDictionary<string, object?> record) =>
        Left.Matches(record) || Right.Matches(record);
}

public sealed record AllOf(Filter Left, Filter Right) : Filter
{
    public override bool Matches(IReadOnlyDictionary<string, object?> record) =>
        Left.Matches(record) && Right.Matches(record);
}

public sealed record Not(Filter Inner) : Filter
{
    public override bool Matches(IReadOnlyDictionary<string, object?> record) => !Inner.Matches(record);
}

public sealed record Present(string Field) : Filter
{
    public override bool Matches(IReadOnlyDictionary<string, object?> record) =>
        record.TryGetValue(Field, out var value) && value switch
        {
            null => false,
            bool flag => flag,
            string text => text.Length > 0,
            _ => true,
        };
}

public sealed record Comparison(string Field, string Operator, object Value) : Filter
{
    /// <summary>
    /// Text compares without regard to case, numbers compare as numbers whatever
    /// type the record holds them in, and values of different kinds are never
    /// equal. A missing field equals nothing, so only <c>!=</c> matches it.
    /// </summary>
    public override bool Matches(IReadOnlyDictionary<string, object?> record)
    {
        if (!record.TryGetValue(Field, out var actual) || actual is null)
            return Operator == "!=";

        return (actual, Value) switch
        {
            (string text, string wanted) when Operator == "~" => text.Contains(wanted, StringComparison.OrdinalIgnoreCase),
            (string text, string wanted) => Holds(string.Compare(text, wanted, StringComparison.OrdinalIgnoreCase)),
            (bool flag, bool wanted) => Operator switch
            {
                "=" => flag == wanted,
                "!=" => flag != wanted,
                _ => false,
            },
            (_, decimal wanted) when AsNumber(actual) is { } number => Holds(number.CompareTo(wanted)),
            _ => Operator == "!=",
        };
    }

    private bool Holds(int order) => Operator switch
    {
        "=" => order == 0,
        "!=" => order != 0,
        "<" => order < 0,
        "<=" => order <= 0,
        ">" => order > 0,
        ">=" => order >= 0,
        _ => false,
    };

    // decimal holds every int and long exactly, and any double a person would
    // type into a record; one outside its range is not a number worth comparing.
    private static decimal? AsNumber(object value) => value switch
    {
        int number => number,
        long number => number,
        decimal number => number,
        double number when double.IsFinite(number) && Math.Abs(number) < 7.9e28 => (decimal)number,
        _ => null,
    };
}

/// <summary>
/// A filter that could not be parsed, with where the problem starts, counting from 1.
/// </summary>
public sealed class FilterSyntaxException(string message, int position)
    : FormatException($"{message} at position {position + 1}")
{
    public int Position { get; } = position + 1;
}

internal enum TokenKind { Word, String, Number, Operator, Open, Close, End }

internal readonly record struct Token(TokenKind Kind, string Text, int Position);

internal static class Lexer
{
    // Two-character operators first, so "<=" is not read as "<" followed by "=".
    private static readonly string[] Operators = ["<=", ">=", "!=", "=", "<", ">", "~"];

    public static List<Token> Tokenize(string text)
    {
        var tokens = new List<Token>();
        var index = 0;
        while (index < text.Length)
        {
            var character = text[index];
            var start = index;
            if (char.IsWhiteSpace(character))
            {
                index++;
            }
            else if (character is '(' or ')')
            {
                tokens.Add(new Token(character == '(' ? TokenKind.Open : TokenKind.Close, character.ToString(), index++));
            }
            else if (character == '"')
            {
                var value = new StringBuilder();
                index++;
                while (true)
                {
                    if (index >= text.Length)
                        throw new FilterSyntaxException("unterminated string", start);
                    if (text[index] == '"')
                        break;
                    // A backslash takes the next character literally: \" and \\.
                    if (text[index] == '\\' && index + 1 < text.Length)
                        index++;
                    value.Append(text[index++]);
                }
                index++;
                tokens.Add(new Token(TokenKind.String, value.ToString(), start));
            }
            else if (char.IsAsciiDigit(character) || (character == '-' && index + 1 < text.Length && char.IsAsciiDigit(text[index + 1])))
            {
                index++;
                while (index < text.Length && (char.IsAsciiDigit(text[index]) || text[index] == '.'))
                    index++;
                tokens.Add(new Token(TokenKind.Number, text[start..index], start));
            }
            else if (char.IsLetter(character) || character == '_')
            {
                while (index < text.Length && (char.IsLetterOrDigit(text[index]) || text[index] is '_' or '.'))
                    index++;
                tokens.Add(new Token(TokenKind.Word, text[start..index], start));
            }
            else if (Operators.FirstOrDefault(op => string.CompareOrdinal(text, index, op, 0, op.Length) == 0) is { } op)
            {
                tokens.Add(new Token(TokenKind.Operator, op, start));
                index += op.Length;
            }
            else
            {
                throw new FilterSyntaxException($"unexpected '{character}'", index);
            }
        }
        tokens.Add(new Token(TokenKind.End, "", text.Length));
        return tokens;
    }
}

internal sealed class Parser(List<Token> tokens)
{
    private int _next;

    private Token Peek => tokens[_next];

    public Filter ParseAll()
    {
        var filter = ParseOr();
        if (Peek.Kind != TokenKind.End)
            throw new FilterSyntaxException($"unexpected '{Peek.Text}'", Peek.Position);
        return filter;
    }

    private Filter ParseOr()
    {
        var filter = ParseAnd();
        while (TakeKeyword("or"))
            filter = new AnyOf(filter, ParseAnd());
        return filter;
    }

    private Filter ParseAnd()
    {
        var filter = ParseUnary();
        while (TakeKeyword("and"))
            filter = new AllOf(filter, ParseUnary());
        return filter;
    }

    private Filter ParseUnary() => TakeKeyword("not") ? new Not(ParseUnary()) : ParsePrimary();

    private Filter ParsePrimary()
    {
        var token = tokens[_next++];
        if (token.Kind == TokenKind.Open)
        {
            var inner = ParseOr();
            if (Peek.Kind != TokenKind.Close)
                throw new FilterSyntaxException("expected ')'", Peek.Position);
            _next++;
            return inner;
        }
        if (token.Kind == TokenKind.End)
            throw new FilterSyntaxException("the filter ends too soon", token.Position);
        if (token.Kind != TokenKind.Word || IsKeyword(token.Text))
            throw new FilterSyntaxException($"expected a field name, found '{token.Text}'", token.Position);
        if (Peek.Kind != TokenKind.Operator)
            return new Present(token.Text);

        var op = tokens[_next++].Text;
        return new Comparison(token.Text, op, ParseValue(op));
    }

    private object ParseValue(string op)
    {
        var token = tokens[_next++];
        object value = token.Kind switch
        {
            TokenKind.String => token.Text,
            TokenKind.Number when decimal.TryParse(token.Text, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint,
                CultureInfo.InvariantCulture, out var number) => number,
            TokenKind.Word when token.Text is "true" or "false" => token.Text == "true",
            TokenKind.End => throw new FilterSyntaxException($"expected a value after '{op}'", token.Position),
            _ => throw new FilterSyntaxException($"expected a value after '{op}', found '{token.Text}'", token.Position),
        };
        if (op == "~" && value is not string)
            throw new FilterSyntaxException("'~' searches text, so it needs a string", token.Position);
        return value;
    }

    private bool TakeKeyword(string keyword)
    {
        if (Peek.Kind != TokenKind.Word || !Peek.Text.Equals(keyword, StringComparison.OrdinalIgnoreCase))
            return false;
        _next++;
        return true;
    }

    private static bool IsKeyword(string word) => word.ToLowerInvariant() is "and" or "or" or "not";
}
