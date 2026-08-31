using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Input;

namespace ContentExample;

/// <summary>
/// Example Game1 that loads a Texture2D and a non-streaming SoundEffect from
/// content. Content.RootDirectory is set to "Content" by the Playground preview
/// runtime before Game.Run, so Content.Load&lt;Texture2D&gt;("textures/player")
/// resolves to Content/textures/player.xnb and
/// Content.Load&lt;SoundEffect&gt;("audio/blip") resolves to Content/audio/blip.xnb
/// in the virtual filesystem.
///
/// Press Space to play the sound and Escape to stop it. Browsers only unlock
/// audio after a real user gesture, so the first key press both activates the
/// audio device and starts playback; this is re-established from scratch every
/// time the preview is recreated by Stop/Run.
/// </summary>
public class Game1 : Game
{
    private GraphicsDeviceManager _graphics;
    private SpriteBatch? _spriteBatch;
    private Texture2D? _playerTexture;
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
        _playerTexture = Content.Load<Texture2D>("textures/player");
        _sound = Content.Load<SoundEffect>("audio/blip");
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

        if (_spriteBatch is not null && _playerTexture is not null)
        {
            _spriteBatch.Begin(samplerState: SamplerState.PointClamp);
            // Draw the 4x4 texture scaled up to 160x160 so pixel pattern is visible
            _spriteBatch.Draw(
                _playerTexture,
                new Rectangle(10, 10, 160, 160),
                Color.White);
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
