/**
 * Issue 040: dependency-free proof contract shared by the packaged proof and the
 * static tests — the exact content-validator case matrix the managed validator
 * must reproduce, and the test game that exercises the SoundEffect API.
 */

/** Validator cases the managed content validator must reproduce exactly. */
export const ISSUE040_EXPECTED_VALIDATOR_CASES: Record<string, readonly [boolean, string | null]> = {
  "good-fixture": [true, null],
  "wrong-platform": [false, "PG0010_CONTENT_PLATFORM_MISMATCH"],
  compressed: [false, "PG0203_CONTENT_COMPRESSED"],
  truncated: [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "bad-magic": [false, "PG0201_CONTENT_INVALID_HEADER"],
  "bad-size": [false, "PG0204_CONTENT_SIZE_MISMATCH"],
  "appended-bytes": [false, "PG0204_CONTENT_SIZE_MISMATCH"],
  "suffixed-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "multi-reader": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "unsupported-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "bad-root-index": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "wrong-mip-size": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "zero-width": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "excess-mip-count": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "nonzero-shared-resources": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "malformed-7bit": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "wrong-reader-version": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "wrong-reader-assembly": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "invalid-utf8": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "overlong-7bit": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "dimension-impossible-mips": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-good-fixture": [true, null],
  "sound-good-stereo-8bit": [true, null],
  "sound-wrong-platform": [false, "PG0010_CONTENT_PLATFORM_MISMATCH"],
  "sound-compressed-flag": [false, "PG0203_CONTENT_COMPRESSED"],
  "sound-non-pcm-format": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-bad-format-size": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-nonzero-cbsize": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-bad-channels": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-bad-bits": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-bad-sample-rate": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-block-align-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-average-bytes-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-zero-data": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-unaligned-data": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-data-size-overflow": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-loop-out-of-range": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-negative-loop-start": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-duration-mismatch": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-trailing-bytes": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-truncated-tail": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-multi-reader": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-suffixed-reader": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-wrong-reader-version": [false, "PG0206_CONTENT_UNSUPPORTED_TYPE"],
  "sound-bad-root-index": [false, "PG0205_CONTENT_MALFORMED_READERS"],
  "sound-nonzero-shared-resources": [false, "PG0205_CONTENT_MALFORMED_READERS"],
};

/**
 * Test game for the packaged proof. Space plays the mounted SoundEffect through a
 * looping `SoundEffectInstance`, Escape stops it, and every observation the proof
 * reads back is a value the game records about its own MonoGame API calls.
 */
export const ISSUE040_GAME_SOURCE = `
using System;
using System.Threading;
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

public sealed class Game1 : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private SoundEffect _sound;
    private SoundEffectInstance _instance;
    private bool _playHeld;
    private bool _stopHeld;
    private bool _stopSettlePending;

    private static int _frameCount;
    private static int _updateCount;
    private static int _disposeCount;
    private static int _runCount;
    private static int _staticConstructorCount;
    private static int _soundLoadedCount;
    private static int _soundDurationMilliseconds;
    private static int _playInvocationCount;
    private static int _stopInvocationCount;
    private static int _observedPlayingUpdateCount;
    private static int _triggerObservationCount;
    private static string _soundAssetName = "";
    private static string _stateAfterPlay = "";
    private static string _stateAtStopCall = "";
    private static string _stateAfterStop = "";
    private static string _currentInstanceState = "";
    private static string _lastTriggerSource = "";
    private static string _audioErrorText = "";

    static Game1() { _staticConstructorCount++; }

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int UpdateCount => Volatile.Read(ref _updateCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int RunCount => Volatile.Read(ref _runCount);
    public static int StaticConstructorCount => Volatile.Read(ref _staticConstructorCount);
    public static int SoundLoadedCount => Volatile.Read(ref _soundLoadedCount);
    public static int SoundDurationMilliseconds => Volatile.Read(ref _soundDurationMilliseconds);
    public static int PlayInvocationCount => Volatile.Read(ref _playInvocationCount);
    public static int StopInvocationCount => Volatile.Read(ref _stopInvocationCount);
    public static int ObservedPlayingUpdateCount => Volatile.Read(ref _observedPlayingUpdateCount);
    public static int TriggerObservationCount => Volatile.Read(ref _triggerObservationCount);
    public static string SoundAssetName => Volatile.Read(ref _soundAssetName);
    public static string StateAfterPlay => Volatile.Read(ref _stateAfterPlay);
    public static string StateAtStopCall => Volatile.Read(ref _stateAtStopCall);
    public static string StateAfterStop => Volatile.Read(ref _stateAfterStop);
    public static string CurrentInstanceState => Volatile.Read(ref _currentInstanceState);
    public static string LastTriggerSource => Volatile.Read(ref _lastTriggerSource);
    public static string AudioErrorText => Volatile.Read(ref _audioErrorText);

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
        Interlocked.Increment(ref _runCount);
    }

    protected override void LoadContent()
    {
        try
        {
            _sound = Content.Load<SoundEffect>("audio/blip");
            Volatile.Write(ref _soundAssetName, _sound.Name ?? "");
            Volatile.Write(ref _soundDurationMilliseconds, (int)_sound.Duration.TotalMilliseconds);
            Interlocked.Increment(ref _soundLoadedCount);
        }
        catch (Exception exception)
        {
            Record("load:" + exception.GetType().Name + ":" + exception.Message);
        }
        base.LoadContent();
    }

    protected override void Update(GameTime gameTime)
    {
        Interlocked.Increment(ref _updateCount);

        var keyboard = Keyboard.GetState();
        var mouse = Mouse.GetState();
        var spaceDown = keyboard.IsKeyDown(Keys.Space);
        var escapeDown = keyboard.IsKeyDown(Keys.Escape);
        var leftDown = mouse.LeftButton == ButtonState.Pressed;
        var rightDown = mouse.RightButton == ButtonState.Pressed;
        var playPressed = spaceDown || leftDown;
        var stopPressed = escapeDown || rightDown;

        if (playPressed && !_playHeld)
        {
            Interlocked.Increment(ref _triggerObservationCount);
            Volatile.Write(ref _lastTriggerSource, spaceDown ? "keyboard-space" : "mouse-left");
            Play();
        }
        _playHeld = playPressed;

        if (stopPressed && !_stopHeld)
        {
            Interlocked.Increment(ref _triggerObservationCount);
            Volatile.Write(ref _lastTriggerSource, escapeDown ? "keyboard-escape" : "mouse-right");
            Stop();
        }
        _stopHeld = stopPressed;

        if (_instance != null)
        {
            var state = _instance.State;
            Volatile.Write(ref _currentInstanceState, state.ToString());
            if (state == SoundState.Playing)
                Interlocked.Increment(ref _observedPlayingUpdateCount);
            // The native audio backend settles a stop on its own mixer callback,
            // so the halted state is recorded on the first update that observes it.
            if (_stopSettlePending && state != SoundState.Playing)
            {
                Volatile.Write(ref _stateAfterStop, state.ToString());
                _stopSettlePending = false;
            }
        }

        base.Update(gameTime);
    }

    private void Play()
    {
        if (_sound == null) return;
        try
        {
            if (_instance != null)
            {
                _instance.Stop();
                _instance.Dispose();
                _instance = null;
            }
            _instance = _sound.CreateInstance();
            _instance.IsLooped = true;
            _instance.Volume = 0.35f;
            _instance.Play();
            Interlocked.Increment(ref _playInvocationCount);
            Volatile.Write(ref _stateAfterPlay, _instance.State.ToString());
        }
        catch (Exception exception)
        {
            Record("play:" + exception.GetType().Name + ":" + exception.Message);
        }
    }

    private void Stop()
    {
        if (_instance == null) return;
        try
        {
            _instance.Stop();
            Interlocked.Increment(ref _stopInvocationCount);
            Volatile.Write(ref _stateAtStopCall, _instance.State.ToString());
            _stopSettlePending = true;
        }
        catch (Exception exception)
        {
            Record("stop:" + exception.GetType().Name + ":" + exception.Message);
        }
    }

    private static void Record(string text)
    {
        var existing = Volatile.Read(ref _audioErrorText);
        Volatile.Write(ref _audioErrorText, existing.Length == 0 ? text : existing + " | " + text);
    }

    protected override void Draw(GameTime gameTime)
    {
        var playing = _instance != null && _instance.State == SoundState.Playing;
        GraphicsDevice.Clear(playing ? new Color(16, 160, 64, 255) : new Color(24, 24, 32, 255));
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Increment(ref _disposeCount);
            if (_instance != null)
            {
                _instance.Stop();
                _instance.Dispose();
                _instance = null;
            }
        }
        base.Dispose(disposing);
    }
}`;
