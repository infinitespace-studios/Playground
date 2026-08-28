using System.Collections.Immutable;
using System.Diagnostics;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Text;

namespace Playground.Preview;

internal sealed class RuntimeExceptionMapper
{
    private const int MaximumFrames = 5;
    private readonly Assembly _assembly;
    private readonly byte[] _pdb;
    private readonly HashSet<string> _sourcePaths;

    public RuntimeExceptionMapper(Assembly assembly, byte[] pdb, IEnumerable<string> sourcePaths)
    {
        _assembly = assembly;
        _pdb = pdb.ToArray();
        _sourcePaths = new HashSet<string>(sourcePaths, StringComparer.Ordinal);
    }

    public RuntimeExceptionReport? Map(Exception exception)
    {
        var trace = new StackTrace(exception, true);
        var frames = new List<RuntimeSourceFrame>();
        foreach (var frame in trace.GetFrames() ?? [])
        {
            var method = frame.GetMethod();
            if (method?.Module.Assembly != _assembly)
                continue;
            var mapped = MapFrame(frame, method);
            if (mapped is not null)
                frames.Add(mapped);
            if (frames.Count == MaximumFrames)
                break;
        }
        if (frames.Count == 0)
            return null;

        IReadOnlyList<Exception> inners = exception is AggregateException aggregate
            ? aggregate.Flatten().InnerExceptions
            : exception.InnerException is null ? [] : [exception.InnerException];
        return new RuntimeExceptionReport(
            Bound(TypeName(exception.GetType()), 512),
            Bound(string.IsNullOrEmpty(exception.Message)
                ? "An unhandled user exception occurred."
                : exception.Message, 1024),
            frames.ToArray(),
            inners.Count,
            inners.Count == 0 ? null : Bound(TypeName(inners[0].GetType()), 512),
            inners.Count == 0 ? null : Bound(inners[0].Message, 1024),
            null,
            null,
            null,
            null,
            null,
            null);
    }

    private RuntimeSourceFrame? MapFrame(StackFrame frame, MethodBase method)
    {
        var methodIdentity = Bound(
            $"{method.DeclaringType?.FullName ?? "<global>"}.{method.Name}", 1024);
        var automaticFile = frame.GetFileName();
        if (automaticFile is not null && _sourcePaths.Contains(automaticFile) &&
            frame.GetFileLineNumber() > 0)
        {
            return new RuntimeSourceFrame(
                methodIdentity, automaticFile, frame.GetFileLineNumber(),
                Math.Max(1, frame.GetFileColumnNumber()), method.MetadataToken, frame.GetILOffset());
        }

        var token = method.MetadataToken;
        var row = token & 0x00FFFFFF;
        var ilOffset = frame.GetILOffset();
        if ((token & unchecked((int)0xFF000000)) != 0x06000000 || row <= 0 || ilOffset < 0)
            return null;
        try
        {
            using var provider = MetadataReaderProvider.FromPortablePdbImage(
                ImmutableArray.Create(_pdb));
            var reader = provider.GetMetadataReader();
            var handle = MetadataTokens.MethodDebugInformationHandle(row);
            if (handle.IsNil || row > reader.MethodDebugInformation.Count)
                return null;
            var information = reader.GetMethodDebugInformation(handle);
            SequencePoint? selected = null;
            foreach (var point in information.GetSequencePoints())
            {
                if (point.IsHidden || point.Offset > ilOffset)
                    continue;
                if (selected is null || point.Offset >= selected.Value.Offset)
                    selected = point;
            }
            if (selected is null)
                return null;
            var sequencePoint = selected.Value;
            var documentHandle = sequencePoint.Document.IsNil
                ? information.Document
                : sequencePoint.Document;
            if (documentHandle.IsNil)
                return null;
            var file = reader.GetString(reader.GetDocument(documentHandle).Name);
            if (!_sourcePaths.Contains(file) || sequencePoint.StartLine <= 0)
                return null;
            return new RuntimeSourceFrame(
                methodIdentity, file, sequencePoint.StartLine,
                Math.Max(1, sequencePoint.StartColumn), token, ilOffset);
        }
        catch (Exception exception) when (
            exception is BadImageFormatException or
            ArgumentException or
            InvalidOperationException)
        {
            return null;
        }
    }

    private static string TypeName(Type type) => type.FullName ?? type.Name;

    private static string Bound(string value, int maximumUtf8Bytes)
    {
        var builder = new StringBuilder();
        var bytes = 0;
        foreach (var rune in value.EnumerateRunes())
        {
            if (bytes + rune.Utf8SequenceLength > maximumUtf8Bytes - 3)
                break;
            builder.Append(rune);
            bytes += rune.Utf8SequenceLength;
        }
        return bytes == Encoding.UTF8.GetByteCount(value)
            ? builder.ToString()
            : builder.Append('…').ToString();
    }
}

internal sealed record RuntimeSourceFrame(
    string Method, string File, int Line, int Column, int MethodToken, int IlOffset);

internal sealed record RuntimeExceptionReport(
    string ExceptionType,
    string Message,
    RuntimeSourceFrame[] Frames,
    int InnerCount,
    string? InnerExceptionType,
    string? InnerMessage,
    bool? CleanupSucceeded,
    int? DisposeAttempts,
    int? FrameCount,
    int? UpdateCount,
    int? ProofDisposeCount,
    int? CallbackAfterDisposedCount);
