using Microsoft.Xna.Framework;

/// A single simulated actor. Deliberately ordinary gameplay code: a small
/// amount of state, a handful of methods, and no host or interop access.
public sealed class Entity
{
    private Vector2 _position;
    private Vector2 _velocity;
    private float _age;
    private bool _alive;

    public Entity(Vector2 position, Vector2 velocity, float lifetimeSeconds)
    {
        _position = position;
        _velocity = velocity;
        LifetimeSeconds = lifetimeSeconds;
        _alive = true;
    }

    public Vector2 Position => _position;

    public Vector2 Velocity => _velocity;

    public float Age => _age;

    public float LifetimeSeconds { get; }

    public bool Alive => _alive;

    public float Speed => _velocity.Length();

    public void Step(float seconds, Rectangle bounds)
    {
        if (!_alive)
            return;

        _age += seconds;
        if (_age >= LifetimeSeconds)
        {
            _alive = false;
            return;
        }

        _position += _velocity * seconds;
        Bounce(bounds);
    }

    public void Revive(Vector2 position, Vector2 velocity)
    {
        _position = position;
        _velocity = velocity;
        _age = 0f;
        _alive = true;
    }

    public Color Tint(Color low, Color high)
    {
        float ratio = LifetimeSeconds <= 0f
            ? 0f
            : MathUtilities.Saturate(_age / LifetimeSeconds);
        return MathUtilities.MixColor(low, high, ratio);
    }

    private void Bounce(Rectangle bounds)
    {
        if (_position.X < bounds.Left)
        {
            _position.X = bounds.Left;
            _velocity.X = -_velocity.X;
        }
        else if (_position.X > bounds.Right)
        {
            _position.X = bounds.Right;
            _velocity.X = -_velocity.X;
        }

        if (_position.Y < bounds.Top)
        {
            _position.Y = bounds.Top;
            _velocity.Y = -_velocity.Y;
        }
        else if (_position.Y > bounds.Bottom)
        {
            _position.Y = bounds.Bottom;
            _velocity.Y = -_velocity.Y;
        }
    }
}
