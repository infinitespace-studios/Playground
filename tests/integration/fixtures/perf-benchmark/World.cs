using Microsoft.Xna.Framework;
using System.Collections.Generic;

/// Owns the entity collection and advances the simulation. The loops here are
/// intentionally plain so the compiler workload resembles ordinary gameplay
/// code rather than a synthetic stress test.
public sealed class World
{
    private readonly List<Entity> _entities = new List<Entity>();
    private readonly int _capacity;
    private int _steps;
    private float _elapsedSeconds;

    public World(int capacity)
    {
        _capacity = capacity < 1 ? 1 : capacity;
    }

    public int Count => _entities.Count;

    public int Steps => _steps;

    public float ElapsedSeconds => _elapsedSeconds;

    public int LiveCount
    {
        get
        {
            int live = 0;
            for (int index = 0; index < _entities.Count; index++)
            {
                if (_entities[index].Alive)
                    live++;
            }

            return live;
        }
    }

    public void Populate(Rectangle bounds)
    {
        _entities.Clear();
        for (int index = 0; index < _capacity; index++)
        {
            _entities.Add(new Entity(
                SpawnPosition(index, bounds),
                SpawnVelocity(index),
                2f + MathUtilities.Fraction(index, 7) * 4f));
        }
    }

    public void Step(float seconds, Rectangle bounds)
    {
        _steps++;
        _elapsedSeconds += seconds;
        for (int index = 0; index < _entities.Count; index++)
        {
            Entity entity = _entities[index];
            entity.Step(seconds, bounds);
            if (!entity.Alive)
                entity.Revive(SpawnPosition(index + _steps, bounds), SpawnVelocity(index + _steps));
        }
    }

    public float AverageSpeed()
    {
        if (_entities.Count == 0)
            return 0f;

        float total = 0f;
        for (int index = 0; index < _entities.Count; index++)
            total += _entities[index].Speed;

        return total / _entities.Count;
    }

    public Color BackgroundColor()
    {
        float pulse = MathUtilities.Saturate(MathUtilities.Triangle(_elapsedSeconds, 4f));
        return MathUtilities.MixColor(Color.CornflowerBlue, Color.MidnightBlue, pulse);
    }

    private static Vector2 SpawnPosition(int seed, Rectangle bounds)
    {
        float x = bounds.Left + MathUtilities.Fraction(seed, 13) * bounds.Width;
        float y = bounds.Top + MathUtilities.Fraction(seed, 11) * bounds.Height;
        return new Vector2(x, y);
    }

    private static Vector2 SpawnVelocity(int seed)
    {
        float x = (MathUtilities.Fraction(seed, 5) - 0.5f) * 120f;
        float y = (MathUtilities.Fraction(seed, 3) - 0.5f) * 120f;
        return new Vector2(x, y);
    }
}
