using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Text;
using Microsoft.Xna.Framework;

namespace Playground.Preview;

internal sealed class GameRunner : IDisposable
{
    private const int MaxDiagnosticMessageBytes = 4 * 1024;
    private readonly Assembly _userAssembly;
    private readonly object _gate = new();
    private DiscoveryResult? _discovery;
    private ConstructionResult? _construction;
    private Game? _game;
    private bool _disposed;
    private int _constructionAttempts;
    private int _disposeAttempts;

    public GameRunner(Assembly userAssembly)
    {
        _userAssembly = userAssembly ?? throw new ArgumentNullException(nameof(userAssembly));
    }

    public DiscoveryResult DiscoverGameType()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return _discovery ??= DiscoverGameType(_userAssembly);
        }
    }

    public ConstructionResult ConstructGame()
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_construction is not null) return _construction;

            var discovery = _discovery ??= DiscoverGameType(_userAssembly);
            if (!discovery.Success)
            {
                return _construction = new ConstructionResult(
                    false, null, false, discovery.Diagnostic, null, _constructionAttempts, false);
            }

            object? created = null;
            try
            {
                _constructionAttempts++;
                created = Activator.CreateInstance(discovery.GameType!);
                if (created is not Game game)
                {
                    DisposeUnexpectedObject(created);
                    return _construction = ConstructionFailure(
                        "The discovered game type could not be constructed as a MonoGame Game.");
                }

                _game = game;
                return _construction = new ConstructionResult(
                    true, SafeTypeName(game.GetType()), true, null, null, _constructionAttempts, true);
            }
            catch (TargetInvocationException exception) when (exception.InnerException is not null)
            {
                var cause = exception.InnerException;
                if (IsFatal(cause)) ExceptionDispatchInfo.Capture(cause).Throw();
                DisposeUnexpectedObject(created);
                return _construction = ConstructionFailure(
                    "The game constructor failed before preview startup.");
            }
            catch (Exception exception) when (IsExpectedReflectionConstructionFailure(exception))
            {
                DisposeUnexpectedObject(created);
                return _construction = ConstructionFailure(
                    "The game type could not be constructed by this preview runtime.");
            }
        }
    }

    public DisposalResult Teardown()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return new DisposalResult(true, false, _disposeAttempts, false, null);
            }

            _disposed = true;
            var game = _game;
            _game = null;
            if (game is null)
            {
                return new DisposalResult(true, false, _disposeAttempts, false, null);
            }

            _disposeAttempts++;
            try
            {
                game.Dispose();
                return new DisposalResult(true, true, _disposeAttempts, false, null);
            }
            catch (Exception exception) when (!IsFatal(exception))
            {
                return new DisposalResult(
                    false, true, _disposeAttempts, false,
                    new RunnerError("PREVIEW_STOP_FAILED", "The game failed during cooperative preview teardown."));
            }
        }
    }

    public void Dispose() => Teardown();

    internal static DiscoveryResult DiscoverGameType(Assembly assembly)
    {
        ArgumentNullException.ThrowIfNull(assembly);

        Type[] types;
        try
        {
            types = assembly.GetTypes();
        }
        catch (Exception exception) when (IsExpectedTypeEnumerationFailure(exception))
        {
            return DiscoveryResult.Failure(Diagnostic(
                "PG0004_UNSUPPORTED_ASSEMBLY",
                "The user assembly contains types that cannot be inspected by this preview runtime."));
        }

        try
        {
            var candidates = types
                .Where(IsGameCandidate)
                .Select(type => new Candidate(type, SafeTypeName(type)))
                .OrderBy(candidate => candidate.Name, StringComparer.Ordinal)
                .ThenBy(candidate => SafeMetadataToken(candidate.Type))
                .ToArray();

            if (candidates.Length == 0)
            {
                return DiscoveryResult.Failure(Diagnostic(
                    "PG0001_NO_GAME_SUBCLASS",
                    "No concrete Game subclass was found. Define one class that inherits from Microsoft.Xna.Framework.Game."));
            }

            if (candidates.Length > 1)
            {
                var names = candidates.Select(candidate => candidate.Name).ToArray();
                return DiscoveryResult.Failure(Diagnostic(
                    "PG0002_MULTIPLE_GAME_SUBCLASSES",
                    BuildMultipleTypeMessage(names)));
            }

            var candidate = candidates[0];
            var constructor = candidate.Type.GetConstructor(
                BindingFlags.Instance | BindingFlags.Public,
                binder: null,
                Type.EmptyTypes,
                modifiers: null);
            if (candidate.Type.ContainsGenericParameters ||
                constructor is null)
            {
                return DiscoveryResult.Failure(Diagnostic(
                    "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR",
                    BoundMessage(
                        $"{candidate.Name} must be non-generic and have a public parameterless constructor.")));
            }

            return new DiscoveryResult(true, candidate.Type, candidate.Name, null);
        }
        catch (Exception exception) when (IsExpectedTypeEnumerationFailure(exception))
        {
            return DiscoveryResult.Failure(Diagnostic(
                "PG0004_UNSUPPORTED_ASSEMBLY",
                "The user assembly contains types that cannot be inspected by this preview runtime."));
        }
    }

    private static bool IsGameCandidate(Type type)
        => type != typeof(Game) &&
            type.IsClass &&
            !type.IsAbstract &&
            typeof(Game).IsAssignableFrom(type);

    private static bool IsExpectedTypeEnumerationFailure(Exception exception) =>
        exception is ReflectionTypeLoadException or
            TypeLoadException or
            FileLoadException or
            FileNotFoundException or
            BadImageFormatException or
            NotSupportedException;

    private static bool IsExpectedReflectionConstructionFailure(Exception exception) =>
        exception is MemberAccessException or
            MissingMethodException or
            TypeLoadException or
            InvalidCastException or
            NotSupportedException;

    private ConstructionResult ConstructionFailure(string message) =>
        new(false, null, false, null, new RunnerError("PREVIEW_START_FAILED", message),
            _constructionAttempts, false);

    private static void DisposeUnexpectedObject(object? created)
    {
        if (created is not IDisposable disposable) return;
        try
        {
            disposable.Dispose();
        }
        catch (Exception exception) when (!IsFatal(exception))
        {
            // The construction error remains the primary boundary result.
        }
    }

    internal static bool IsFatal(Exception exception) =>
        exception is OutOfMemoryException or
            StackOverflowException or
            AccessViolationException or
            AppDomainUnloadedException or
            CannotUnloadAppDomainException;

    private static PlaygroundDiagnostic Diagnostic(string id, string message) =>
        new("playground", "error", id, BoundMessage(message), "", 0, 0);

    private static string BuildMultipleTypeMessage(IReadOnlyList<string> names)
    {
        const string prefix = "Multiple concrete Game subclasses were found: ";
        const string suffix = ". Exactly one is required.";
        var builder = new StringBuilder(prefix);
        for (var index = 0; index < names.Count; index++)
        {
            var separator = index == 0 ? "" : ", ";
            var remainingSuffix = $", and {names.Count - index} more{suffix}";
            if (Encoding.UTF8.GetByteCount(builder.ToString() + separator + names[index] + suffix) >
                MaxDiagnosticMessageBytes)
            {
                builder.Append(remainingSuffix);
                return BoundMessage(builder.ToString());
            }
            builder.Append(separator).Append(names[index]);
        }
        return BoundMessage(builder.Append(suffix).ToString());
    }

    private static string SafeTypeName(Type type)
    {
        string? value;
        try
        {
            value = type.FullName ?? type.Name;
        }
        catch (Exception exception) when (exception is TypeLoadException or NotSupportedException)
        {
            value = null;
        }

        if (string.IsNullOrWhiteSpace(value)) return "<unnamed-type>";
        var sanitized = new string(value.Select(character =>
            char.IsControl(character) || char.IsSurrogate(character) ? '\uFFFD' : character).ToArray());
        return BoundUtf8(sanitized, 512);
    }

    private static int SafeMetadataToken(Type type)
    {
        try
        {
            return type.MetadataToken;
        }
        catch (Exception exception) when (exception is InvalidOperationException or NotSupportedException)
        {
            return int.MaxValue;
        }
    }

    private static string BoundMessage(string message) => BoundUtf8(message, MaxDiagnosticMessageBytes);

    private static string BoundUtf8(string value, int maxBytes)
    {
        if (Encoding.UTF8.GetByteCount(value) <= maxBytes) return value;
        const string ellipsis = "…";
        var budget = maxBytes - Encoding.UTF8.GetByteCount(ellipsis);
        var builder = new StringBuilder(value.Length);
        var used = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            var bytes = rune.Utf8SequenceLength;
            if (used + bytes > budget) break;
            builder.Append(rune);
            used += bytes;
        }
        return builder.Append(ellipsis).ToString();
    }

    private sealed record Candidate(Type Type, string Name);

    internal sealed record DiscoveryResult(
        bool Success,
        Type? GameType,
        string? GameTypeFullName,
        PlaygroundDiagnostic? Diagnostic)
    {
        public static DiscoveryResult Failure(PlaygroundDiagnostic diagnostic) =>
            new(false, null, null, diagnostic);
    }

    internal sealed record ConstructionResult(
        bool Success,
        string? ConstructedTypeFullName,
        bool AssignableToGame,
        PlaygroundDiagnostic? Diagnostic,
        RunnerError? Error,
        int ConstructionAttempts,
        bool RetainedGame);

    internal sealed record DisposalResult(
        bool Success,
        bool HadGame,
        int DisposeAttempts,
        bool RetainedGame,
        RunnerError? Error);

    internal sealed record PlaygroundDiagnostic(
        string Origin,
        string Severity,
        string Id,
        string Message,
        string File,
        int Line,
        int Column);

    internal sealed record RunnerError(string Code, string Message);
}
