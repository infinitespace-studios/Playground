using Microsoft.Xna.Framework;

/// Deterministic helpers shared by the other files. No floating point library
/// calls are used, so results are identical on every run and platform.
public static class MathUtilities
{
    public static float Saturate(float value)
    {
        if (value < 0f)
            return 0f;
        if (value > 1f)
            return 1f;
        return value;
    }

    /// Integer hash folded into the [0, 1) range. Used instead of Random so the
    /// benchmark project behaves identically on every compile and run.
    public static float Fraction(int seed, int modulus)
    {
        int divisor = modulus < 2 ? 2 : modulus;
        int folded = unchecked((seed * 1103515245) + 12345) ^ (seed << 3);
        int bucket = folded % divisor;
        if (bucket < 0)
            bucket += divisor;
        return (float)bucket / divisor;
    }

    /// Rising/falling ramp in [0, 1] with the supplied period in seconds.
    public static float Triangle(float seconds, float period)
    {
        if (period <= 0f)
            return 0f;

        float phase = seconds - period * (int)(seconds / period);
        float half = period * 0.5f;
        return phase <= half ? phase / half : (period - phase) / half;
    }

    public static Color MixColor(Color from, Color to, float ratio)
    {
        float clamped = Saturate(ratio);
        return new Color(
            Blend(from.R, to.R, clamped),
            Blend(from.G, to.G, clamped),
            Blend(from.B, to.B, clamped),
            Blend(from.A, to.A, clamped));
    }

    public static Vector2 Clamp(Vector2 value, Rectangle bounds)
    {
        float x = MathHelper.Clamp(value.X, bounds.Left, bounds.Right);
        float y = MathHelper.Clamp(value.Y, bounds.Top, bounds.Bottom);
        return new Vector2(x, y);
    }

    private static int Blend(byte from, byte to, float ratio)
    {
        float value = from + (to - from) * ratio;
        if (value < 0f)
            return 0;
        if (value > 255f)
            return 255;
        return (int)value;
    }
}
