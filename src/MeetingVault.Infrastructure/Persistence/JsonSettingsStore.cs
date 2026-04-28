using System.Text.Json;
using MeetingVault.Core.Configuration;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Persistence;

/// <summary>
/// Stores <see cref="AppSettings"/> as JSON next to the executable's per-user
/// AppData folder. We deliberately keep this off the per-meeting Documents path
/// so changing <see cref="AppSettings.RootFolderOverride"/> can never desync the
/// settings file from where the user told us to look.
/// </summary>
public class JsonSettingsStore : ISettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly string _settingsPath;
    private readonly ILogger<JsonSettingsStore> _logger;
    private readonly object _lock = new();

    public JsonSettingsStore(ILogger<JsonSettingsStore> logger)
    {
        _logger = logger;
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var folder = Path.Combine(appData, "MeetingVault");
        Directory.CreateDirectory(folder);
        _settingsPath = Path.Combine(folder, "settings.json");
        Current = new AppSettings();
    }

    public AppSettings Current { get; private set; }

    public void Load()
    {
        lock (_lock)
        {
            try
            {
                if (!File.Exists(_settingsPath))
                {
                    Current = new AppSettings();
                    Save();
                    return;
                }

                var json = File.ReadAllText(_settingsPath);
                Current = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions) ?? new AppSettings();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load settings from {Path}; using defaults.", _settingsPath);
                Current = new AppSettings();
            }
        }
    }

    public void Save()
    {
        lock (_lock)
        {
            try
            {
                var json = JsonSerializer.Serialize(Current, JsonOptions);
                File.WriteAllText(_settingsPath, json);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save settings to {Path}.", _settingsPath);
            }
        }
    }

    public void Update(Action<AppSettings> mutate)
    {
        lock (_lock)
        {
            mutate(Current);
            Save();
        }
    }
}
