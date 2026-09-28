namespace Accounts;

/// <summary>
/// The rules a new password has to pass, worded the way the sign-up form shows them.
/// </summary>
/// <remarks>
/// Length and a blocklist rather than "one capital, one digit, one symbol". Composition
/// rules steer people to <c>Password1!</c>, which every cracking list tries first; NIST
/// SP 800-63B dropped them for that reason, and this follows it.
/// </remarks>
public sealed class PasswordPolicy(IReadOnlySet<string> commonPasswords)
{
    public const int MinLength = 12;

    // Long enough for any passphrase, short enough that hashing one is not a way to
    // tie up the server.
    public const int MaxLength = 128;

    /// <summary>
    /// A policy whose blocklist is read from a file with one password per line.
    /// </summary>
    public static PasswordPolicy FromFile(string path) =>
        new(File.ReadLines(path)
            .Select(line => line.Trim().ToLowerInvariant())
            .Where(line => line.Length > 0)
            .ToHashSet());

    /// <summary>
    /// Everything wrong with <paramref name="password"/>, or nothing when it will do.
    /// </summary>
    public IReadOnlyList<string> Problems(string password, string email)
    {
        var problems = new List<string>();

        // Characters as a person counts them: an emoji is one, not the two UTF-16
        // units it is stored as.
        var length = password.EnumerateRunes().Count();
        if (length < MinLength)
            problems.Add($"Use at least {MinLength} characters.");
        if (length > MaxLength)
            problems.Add($"Use at most {MaxLength} characters.");

        if (password.Distinct().Count() < 4)
            problems.Add("Use more than three different characters.");

        var name = email.Split('@')[0];
        if (name.Length >= 3 && password.Contains(name, StringComparison.OrdinalIgnoreCase))
            problems.Add("Leave your email address out of it.");

        if (commonPasswords.Contains(password.ToLowerInvariant()))
            problems.Add("That is one of the most common passwords. Pick something less guessable.");

        return problems;
    }
}
