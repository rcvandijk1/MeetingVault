using System.Windows;
using System.Windows.Controls;
using MeetingVault.App.ViewModels;

namespace MeetingVault.App.Views;

public partial class SettingsView : UserControl
{
    public SettingsView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        Loaded += (_, _) => SyncPasswordBox();
    }

    private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e) => SyncPasswordBox();

    private void SyncPasswordBox()
    {
        // PasswordBox.Password is intentionally not a DependencyProperty (so
        // tooling can't accidentally bind a secret); we sync manually.
        if (DataContext is SettingsViewModel vm && HfTokenBox != null)
            HfTokenBox.Password = vm.HuggingFaceToken ?? string.Empty;
    }

    private void HfTokenBox_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (DataContext is SettingsViewModel vm && sender is PasswordBox pb)
            vm.HuggingFaceToken = string.IsNullOrEmpty(pb.Password) ? null : pb.Password;
    }
}
