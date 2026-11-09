using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Keep long notes wheel-scrollable even without the native scrollbar chrome.
internal sealed class NoteBody : TextBox {
    const int MouseWheelMessage=0x020A,LineScroll=0x00B6;
    int wheelRemainder;
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr handle,int message,IntPtr wParam,IntPtr lParam);
    protected override void WndProc(ref Message message){
        if(message.Msg!=MouseWheelMessage){base.WndProc(ref message);return;}
        wheelRemainder+=unchecked((short)(message.WParam.ToInt64()>>16));
        int steps=wheelRemainder/120;
        wheelRemainder%=120;
        int lines=SystemInformation.MouseWheelScrollLines;
        if(lines<0)lines=Math.Max(1,ClientSize.Height/Font.Height-1);
        if(steps!=0 && lines!=0)SendMessage(Handle,LineScroll,IntPtr.Zero,(IntPtr)(-steps*lines));
        message.Result=IntPtr.Zero;
    }
}
