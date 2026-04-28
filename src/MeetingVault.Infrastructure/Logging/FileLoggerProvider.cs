using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Logging;

/// <summary>
/// Minimal append-only file logger. Lines are flushed per-write so a crash or
/// power loss still leaves the most recent diagnostic information on disk.
/// </summary>
public sealed class FileLoggerProvider : ILoggerProvider
{
    private readonly string _logFolder;
    private readonly object _lock = new();
    private readonly Lazy<string> _logFile;

    public FileLoggerProvider(string logFolder)
    {
        _logFolder = logFolder;
        _logFile = new Lazy<string>(() =>
        {
            Directory.CreateDirectory(_logFolder);
            return Path.Combine(_logFolder, $"meetingvault-{DateTime.Now:yyyyMMdd}.log");
        });
    }

    public ILogger CreateLogger(string categoryName) => new FileLogger(categoryName, this);

    public void Dispose() { }

    internal void Write(string line)
    {
        lock (_lock)
        {
            try
            {
                File.AppendAllText(_logFile.Value, line + Environment.NewLine);
            }
            catch
            {
                // Logging must never crash the host; swallow failures (full disk, locked file, ...).
            }
        }
    }

    private sealed class FileLogger : ILogger
    {
        private readonly string _category;
        private readonly FileLoggerProvider _provider;

        public FileLogger(string category, FileLoggerProvider provider)
        {
            _category = category;
            _provider = provider;
        }

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var msg = formatter(state, exception);
            var line = $"{DateTime.Now:HH:mm:ss.fff} [{logLevel}] {_category}: {msg}";
            if (exception != null)
                line += Environment.NewLine + exception;
            _provider.Write(line);
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
