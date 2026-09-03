using System.Collections.Generic;

/// Rolling statistics over the simulation, kept in a bounded ring buffer so a
/// long-running preview never grows without limit.
public sealed class Telemetry
{
    private const int Capacity = 120;

    private readonly List<float> _speeds = new List<float>(Capacity);
    private readonly List<int> _liveCounts = new List<int>(Capacity);
    private int _nextSlot;
    private int _sampleCount;

    public int SampleCount => _sampleCount;

    public int WindowSize => _speeds.Count;

    public void Record(float averageSpeed, int liveCount)
    {
        _sampleCount++;
        if (_speeds.Count < Capacity)
        {
            _speeds.Add(averageSpeed);
            _liveCounts.Add(liveCount);
            return;
        }

        _speeds[_nextSlot] = averageSpeed;
        _liveCounts[_nextSlot] = liveCount;
        _nextSlot = (_nextSlot + 1) % Capacity;
    }

    public float MeanSpeed()
    {
        if (_speeds.Count == 0)
            return 0f;

        float total = 0f;
        for (int index = 0; index < _speeds.Count; index++)
            total += _speeds[index];

        return total / _speeds.Count;
    }

    public float PeakSpeed()
    {
        float peak = 0f;
        for (int index = 0; index < _speeds.Count; index++)
        {
            if (_speeds[index] > peak)
                peak = _speeds[index];
        }

        return peak;
    }

    public int MinimumLiveCount()
    {
        if (_liveCounts.Count == 0)
            return 0;

        int minimum = _liveCounts[0];
        for (int index = 1; index < _liveCounts.Count; index++)
        {
            if (_liveCounts[index] < minimum)
                minimum = _liveCounts[index];
        }

        return minimum;
    }

    public string Summary()
    {
        return "samples=" + _sampleCount.ToString() +
            ";window=" + _speeds.Count.ToString() +
            ";meanSpeed=" + MeanSpeed().ToString("F2") +
            ";peakSpeed=" + PeakSpeed().ToString("F2") +
            ";minLive=" + MinimumLiveCount().ToString();
    }
}
