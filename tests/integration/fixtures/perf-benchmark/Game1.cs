using Microsoft.Xna.Framework;
using System;
using System.Threading;

/// Entry point of the five-file performance benchmark project.
/// Sized to represent a small but realistic Playground project: a game loop
/// that drives a simulation world, a small entity type, shared math helpers
/// and a telemetry aggregator.
public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private readonly World _world = new World(64);
    private readonly Telemetry _telemetry = new Telemetry();

    private static int _staticConstructorCount;
    private static int _runCount;
    private static int _frameCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;
    private static int _simulatedEntities;
    private int _reported;

    static Game1()
    {
        Interlocked.Increment(ref _staticConstructorCount);
    }

    public Game1()
    {
        Interlocked.Increment(ref _runCount);
        _graphics = new GraphicsDeviceManager(this);
        _graphics.PreferredBackBufferWidth = 640;
        _graphics.PreferredBackBufferHeight = 360;
        Content.RootDirectory = "Content";
        IsMouseVisible = true;
    }

    public static int StaticConstructorCount => Volatile.Read(ref _staticConstructorCount);
    public static int RunCount => Volatile.Read(ref _runCount);
    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount => Volatile.Read(ref _callbackAfterDisposedCount);
    public static int SimulatedEntities => Volatile.Read(ref _simulatedEntities);

    protected override void Initialize()
    {
        _world.Populate(new Rectangle(0, 0, 640, 360));
        Volatile.Write(ref _simulatedEntities, _world.Count);
        base.Initialize();
    }

    protected override void Update(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);

        float seconds = (float)gameTime.ElapsedGameTime.TotalSeconds;
        _world.Step(seconds, new Rectangle(0, 0, 640, 360));
        _telemetry.Record(_world.AverageSpeed(), _world.LiveCount);
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);

        GraphicsDevice.Clear(_world.BackgroundColor());
        Interlocked.Increment(ref _frameCount);

        if (Interlocked.Exchange(ref _reported, 1) == 0)
        {
            Console.WriteLine(
                "perf-benchmark:entities=" + _world.Count.ToString() +
                ";samples=" + _telemetry.SampleCount.ToString());
        }

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
