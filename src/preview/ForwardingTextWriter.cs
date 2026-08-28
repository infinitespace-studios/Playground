using System.Collections.Generic;
using System.Text;

namespace Playground.Preview;

internal sealed class ForwardingTextWriter(Action<string> forward) : TextWriter
{
    private const int MaximumUtf8Bytes = 16 * 1024;
    private readonly object _gate = new();
    private readonly StringBuilder _pending = new();
    private readonly Queue<string> _completed = new();
    private bool _previousWasCarriageReturn;
    private bool _forwarding;
    private bool _disposed;

    public override Encoding Encoding => Encoding.UTF8;

    public override void Write(char value)
    {
        lock (_gate)
        {
            if (_disposed)
                return;
            Accept(value);
            Drain();
        }
    }

    public override void Write(string? value)
    {
        if (value is null)
            return;
        lock (_gate)
        {
            if (_disposed)
                return;
            foreach (var character in value)
                Accept(character);
            Drain();
        }
    }

    public override void Write(char[] buffer, int index, int count)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ArgumentOutOfRangeException.ThrowIfNegative(index);
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        if (index > buffer.Length - count)
            throw new ArgumentException("The index and count exceed the buffer.");
        Write(buffer.AsSpan(index, count));
    }

    public override void Write(ReadOnlySpan<char> buffer)
    {
        lock (_gate)
        {
            if (_disposed)
                return;
            foreach (var character in buffer)
                Accept(character);
            Drain();
        }
    }

    public override void WriteLine(string? value)
    {
        Write(value);
        Write(NewLine);
    }

    public override void Flush()
    {
        lock (_gate)
        {
            if (_disposed)
                return;
            if (_pending.Length > 0)
                CompleteLine();
            _previousWasCarriageReturn = false;
            Drain();
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            lock (_gate)
            {
                if (!_disposed)
                {
                    if (_pending.Length > 0)
                        CompleteLine();
                    _previousWasCarriageReturn = false;
                    Drain();
                    _disposed = true;
                }
            }
        }
        base.Dispose(disposing);
    }

    private void Accept(char value)
    {
        if (value == '\r')
        {
            CompleteLine();
            _previousWasCarriageReturn = true;
            return;
        }
        if (value == '\n')
        {
            if (!_previousWasCarriageReturn)
                CompleteLine();
            _previousWasCarriageReturn = false;
            return;
        }
        _previousWasCarriageReturn = false;
        _pending.Append(value);
    }

    private void CompleteLine()
    {
        _completed.Enqueue(_pending.ToString());
        _pending.Clear();
    }

    private void Drain()
    {
        if (_forwarding)
            return;
        _forwarding = true;
        try
        {
            while (_completed.TryDequeue(out var line))
                ForwardChunks(line);
        }
        finally
        {
            _forwarding = false;
        }
    }

    private void ForwardChunks(string line)
    {
        if (line.Length == 0)
        {
            forward("");
            return;
        }
        var chunk = new StringBuilder();
        var bytes = 0;
        foreach (var rune in line.EnumerateRunes())
        {
            var runeBytes = rune.Utf8SequenceLength;
            if (bytes + runeBytes > MaximumUtf8Bytes)
            {
                forward(chunk.ToString());
                chunk.Clear();
                bytes = 0;
            }
            chunk.Append(rune);
            bytes += runeBytes;
        }
        if (chunk.Length > 0)
            forward(chunk.ToString());
    }
}
