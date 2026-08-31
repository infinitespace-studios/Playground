using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;

namespace ContentExample;

/// <summary>
/// Example Game1 that loads a Texture2D from content and draws it via SpriteBatch.
/// Content.RootDirectory is set to "Content" by the Playground preview runtime
/// before Game.Run, so Content.Load&lt;Texture2D&gt;("textures/player") resolves
/// to Content/textures/player.xnb in the virtual filesystem.
/// </summary>
public class Game1 : Game
{
    private GraphicsDeviceManager _graphics;
    private SpriteBatch? _spriteBatch;
    private Texture2D? _playerTexture;

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
    }

    protected override void Draw(GameTime gameTime)
    {
        // Clear to a distinctive dark background so the texture is visibly different
        GraphicsDevice.Clear(new Color(32, 32, 32, 255));

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
        if (disposing) DisposeCount++;
        base.Dispose(disposing);
    }
}
