using MeetingVault.Core.Configuration;

namespace MeetingVault.Core.Services;

public interface ISettingsStore
{
    AppSettings Current { get; }

    void Load();

    void Save();

    void Update(Action<AppSettings> mutate);
}
