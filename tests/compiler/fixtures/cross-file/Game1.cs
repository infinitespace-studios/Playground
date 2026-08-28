using Microsoft.Xna.Framework;
using System;
using System.Threading;

public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private readonly Player _player = new();
    private static int _frameCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;
    private int _reported;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount =>
        Volatile.Read(ref _callbackAfterDisposedCount);

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        var value = _player.CrossFileValue();
        GraphicsDevice.Clear(_player.FrameColor());
        Interlocked.Increment(ref _frameCount);
        if (Interlocked.Exchange(ref _reported, 1) == 0)
            Console.WriteLine($"issue030-cross-file:value={value};color=LimeGreen");
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _disposed, 1);
            Interlocked.Increment(ref _disposeCount);
        }
        base.Dispose(disposing);
    }
}
