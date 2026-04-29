using System.Diagnostics;
using Microsoft.Win32;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingVault.Core.Services;
using NAudio.CoreAudioApi;

namespace MeetingVault.App.ViewModels;

public partial class SettingsViewModel : ObservableObject
{
    private readonly ISettingsStore _settings;
    private readonly IPathService _paths;

    [ObservableProperty] private string? rootFolder;
    [ObservableProperty] private string? whisperModelPath;
    [ObservableProperty] private string whisperLanguage = "auto";
    [ObservableProperty] private string myDisplayName = "Me";
    [ObservableProperty] private bool autoDetectMeetings = true;
    [ObservableProperty] private bool autoStartRecording;
    [ObservableProperty] private bool saveSeparateAudioStreams = true;
    [ObservableProperty] private bool saveCombinedAudio = true;
    [ObservableProperty] private bool keepRawAudio = true;
    [ObservableProperty] private string? selectedInputDeviceId;
    [ObservableProperty] private string? selectedOutputDeviceId;

    // Diarization / speaker recognition
    [ObservableProperty] private string diarizationEngine = "Stub";
    [ObservableProperty] private string? pythonExecutablePath;
    [ObservableProperty] private string? huggingFaceToken;
    [ObservableProperty] private double speakerMatchThreshold = 0.7;
    [ObservableProperty] private bool enrollVoicesOnSave = true;

    public List<string> DiarizationEngines { get; } = new() { "Stub", "Python" };

    public List<DeviceItem> InputDevices { get; } = new();
    public List<DeviceItem> OutputDevices { get; } = new();

    public SettingsViewModel(ISettingsStore settings, IPathService paths)
    {
        _settings = settings;
        _paths = paths;
        Reload();
        LoadDevices();
    }

    private void Reload()
    {
        var s = _settings.Current;
        RootFolder = string.IsNullOrEmpty(s.RootFolderOverride) ? _paths.RootFolder : s.RootFolderOverride;
        WhisperModelPath = s.WhisperModelPath;
        WhisperLanguage = s.WhisperLanguage;
        MyDisplayName = s.MyDisplayName;
        AutoDetectMeetings = s.AutoDetectMeetings;
        AutoStartRecording = s.AutoStartRecording;
        SaveSeparateAudioStreams = s.SaveSeparateAudioStreams;
        SaveCombinedAudio = s.SaveCombinedAudio;
        KeepRawAudio = s.KeepRawAudio;
        SelectedInputDeviceId = s.DefaultInputDeviceId;
        SelectedOutputDeviceId = s.DefaultOutputDeviceId;
        DiarizationEngine = string.IsNullOrWhiteSpace(s.DiarizationEngine) ? "Stub" : s.DiarizationEngine;
        PythonExecutablePath = s.PythonExecutablePath;
        HuggingFaceToken = s.HuggingFaceToken;
        SpeakerMatchThreshold = s.SpeakerMatchThreshold;
        EnrollVoicesOnSave = s.EnrollVoicesOnSave;
    }

    private void LoadDevices()
    {
        InputDevices.Clear();
        OutputDevices.Clear();
        InputDevices.Add(new DeviceItem(null, "(System default communications input)"));
        OutputDevices.Add(new DeviceItem(null, "(System default communications output)"));
        try
        {
            var enumerator = new MMDeviceEnumerator();
            foreach (var d in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
                InputDevices.Add(new DeviceItem(d.ID, d.FriendlyName));
            foreach (var d in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
                OutputDevices.Add(new DeviceItem(d.ID, d.FriendlyName));
        }
        catch
        {
            // Devices unavailable; leave defaults only.
        }
    }

    [RelayCommand]
    private void Save()
    {
        _settings.Update(s =>
        {
            s.RootFolderOverride = string.Equals(RootFolder, _paths.RootFolder, StringComparison.OrdinalIgnoreCase) ? null : RootFolder;
            s.WhisperModelPath = string.IsNullOrWhiteSpace(WhisperModelPath) ? null : WhisperModelPath;
            s.WhisperLanguage = string.IsNullOrWhiteSpace(WhisperLanguage) ? "auto" : WhisperLanguage;
            s.MyDisplayName = string.IsNullOrWhiteSpace(MyDisplayName) ? "Me" : MyDisplayName;
            s.AutoDetectMeetings = AutoDetectMeetings;
            s.AutoStartRecording = AutoStartRecording;
            s.SaveSeparateAudioStreams = SaveSeparateAudioStreams;
            s.SaveCombinedAudio = SaveCombinedAudio;
            s.KeepRawAudio = KeepRawAudio;
            s.DefaultInputDeviceId = SelectedInputDeviceId;
            s.DefaultOutputDeviceId = SelectedOutputDeviceId;
            s.DiarizationEngine = string.IsNullOrWhiteSpace(DiarizationEngine) ? "Stub" : DiarizationEngine;
            s.PythonExecutablePath = string.IsNullOrWhiteSpace(PythonExecutablePath) ? null : PythonExecutablePath;
            s.HuggingFaceToken = string.IsNullOrWhiteSpace(HuggingFaceToken) ? null : HuggingFaceToken;
            s.SpeakerMatchThreshold = Math.Clamp(SpeakerMatchThreshold, 0.0, 1.0);
            s.EnrollVoicesOnSave = EnrollVoicesOnSave;
        });
        _paths.EnsureFoldersExist();
    }

    [RelayCommand]
    private void BrowseModel()
    {
        var dlg = new OpenFileDialog
        {
            Title = "Select Whisper ggml model file",
            Filter = "Whisper model (*.bin)|*.bin|All files (*.*)|*.*"
        };
        if (dlg.ShowDialog() == true) WhisperModelPath = dlg.FileName;
    }

    [RelayCommand]
    private void BrowseRoot()
    {
        var dlg = new OpenFileDialog
        {
            Title = "Select any file inside the desired root folder (selection of the file's folder will be used)",
            CheckFileExists = false,
            FileName = "select-this-folder",
            Filter = "Folders|*."
        };
        if (dlg.ShowDialog() == true)
        {
            var folder = Path.GetDirectoryName(dlg.FileName);
            if (!string.IsNullOrWhiteSpace(folder)) RootFolder = folder;
        }
    }

    [RelayCommand]
    private void BrowsePython()
    {
        var dlg = new OpenFileDialog
        {
            Title = "Select python.exe (with pyannote.audio installed)",
            Filter = "Python (*.exe)|python.exe;python3.exe|All files (*.*)|*.*"
        };
        if (dlg.ShowDialog() == true) PythonExecutablePath = dlg.FileName;
    }

    [RelayCommand]
    private void OpenRootFolder()
    {
        try
        {
            _paths.EnsureFoldersExist();
            Process.Start(new ProcessStartInfo { FileName = _paths.RootFolder, UseShellExecute = true });
        }
        catch { }
    }
}

public record DeviceItem(string? Id, string Name);
