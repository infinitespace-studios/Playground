using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

namespace ContentExample;

/// <summary>
/// Example Game1 demonstrating the Playground's Content workflow end to end,
/// with NO MGCB build step required for raw assets (issue 052):
///
///   Content.Load&lt;Texture2D&gt;("textures/player") -> Content/textures/player.xnb
///       (a precompiled Web-profile .xnb)
///   Content.Load&lt;Texture2D&gt;("textures/sprite") -> Content/textures/sprite.png
///       (a RAW PNG; the MonoGame Web runtime's Texture2D.FromStream fallback
///        decodes it, so no content pipeline is needed)
///   Content.Load&lt;SoundEffect&gt;("audio/tone")    -> Content/audio/tone.wav
///       (a RAW PCM WAV; the preview transcodes it to an XNB SoundEffect at
///        mount time, so Content.Load resolves it like any other sound)
///
/// Content.RootDirectory is set to "Content" by the Playground preview runtime
/// before Game.Run. Press Space to play the sound and Escape to stop it.
/// Browsers only unlock audio after a real user gesture, so the first key press
/// both activates the audio device and starts playback.
/// </summary>
public class Game1 : Game
{
    private GraphicsDeviceManager _graphics;
    private SpriteBatch? _spriteBatch;
    private Texture2D? _playerTexture;
    private Texture2D? _spriteTexture;
    private SoundEffect? _sound;
    private SoundEffectInstance? _instance;
    private bool _playHeld;
    private bool _stopHeld;

    public static int FrameCount { get; private set; }
    public static int DisposeCount { get; private set; }
    public static int RunCount { get; private set; }
    public static int StaticConstructorCount { get; private set; }

    static Game1()
    {
        StaticConstructorCount++;
    }

    public Game1()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
        RunCount++;
    }

    protected override void LoadContent()
    {
        _spriteBatch = new SpriteBatch(GraphicsDevice);
        // Precompiled .xnb texture (left) and RAW .png texture (right).
        _playerTexture = Content.Load<Texture2D>("textures/player");
        _spriteTexture = Content.Load<Texture2D>("textures/sprite");
        // RAW .wav, transcoded to an XNB SoundEffect at mount time.
        _sound = Content.Load<SoundEffect>("audio/tone");
    }

    protected override void Update(GameTime gameTime)
    {
        var keyboard = Keyboard.GetState();

        var playPressed = keyboard.IsKeyDown(Keys.Space);
        if (playPressed && !_playHeld && _sound is not null)
        {
            _instance?.Stop();
            _instance?.Dispose();
            _instance = _sound.CreateInstance();
            _instance.IsLooped = true;
            _instance.Play();
        }
        _playHeld = playPressed;

        var stopPressed = keyboard.IsKeyDown(Keys.Escape);
        if (stopPressed && !_stopHeld)
        {
            _instance?.Stop();
        }
        _stopHeld = stopPressed;

        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        // Clear to a distinctive dark background so the texture is visibly different,
        // and tint green while the sound effect instance reports playback.
        var playing = _instance is not null && _instance.State == SoundState.Playing;
        GraphicsDevice.Clear(playing ? new Color(16, 96, 48, 255) : new Color(32, 32, 32, 255));

        if (_spriteBatch is not null)
        {
            _spriteBatch.Begin(samplerState: SamplerState.PointClamp);
            // Precompiled .xnb texture, scaled up so its pixel pattern is visible.
            if (_playerTexture is not null)
            {
                _spriteBatch.Draw(
                    _playerTexture,
                    new Rectangle(10, 10, 160, 160),
                    Color.White);
            }
            // RAW .png texture, drawn beside it to prove the no-MGCB path renders.
            if (_spriteTexture is not null)
            {
                _spriteBatch.Draw(
                    _spriteTexture,
                    new Rectangle(190, 10, 160, 160),
                    Color.White);
            }
            _spriteBatch.End();
        }

        FrameCount++;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            DisposeCount++;
            _instance?.Stop();
            _instance?.Dispose();
            _instance = null;
        }

        base.Dispose(disposing);
    }
}
