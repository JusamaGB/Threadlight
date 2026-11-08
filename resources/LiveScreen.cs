using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// A session-scoped Windows helper. Only the Ctrl + right-button gesture is intercepted.
// Coordinates, the outline and bitmap captures all use physical desktop pixels.
public static class ThreadlightLiveScreen {
    delegate IntPtr MouseCallback(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)]
    struct MouseData { public Point point; public uint mouseData, flags, time; public UIntPtr extra; }
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr mode);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr mode);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, MouseCallback callback, IntPtr module, uint thread);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr msg, IntPtr data);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RectangleEdges rect);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
    struct RectangleEdges { public int left, top, right, bottom; }

    static readonly MouseCallback callback = Mouse;
    static IntPtr hook;
    static Outline outline;
    static bool tracking, rightHeld, consumeUp, drawn;
    static readonly UIntPtr replayTag = new UIntPtr(0x544c5343);
    static Point start, end;
    static System.Windows.Forms.Timer timer;

    sealed class Outline : Form {
        public Outline() {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.FromArgb(86, 171, 235);
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {
            get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x20 | 0x80; return p; }
        }
        public void Draw(Rectangle rect) {
            rect.Inflate(2, 2);
            if (Visible && Bounds == rect) return;
            var shape = new Region(new Rectangle(0, 0, rect.Width, rect.Height));
            shape.Exclude(new Rectangle(2, 2, rect.Width-4, rect.Height-4));
            var old = Region;
            Bounds = rect; Region = shape; if (old != null) old.Dispose();
            if (!Visible) Show();
        }
    }
    static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static Rectangle Selection() {
        return Rectangle.FromLTRB(Math.Min(start.X,end.X),Math.Min(start.Y,end.Y),
            Math.Max(start.X,end.X),Math.Max(start.Y,end.Y));
    }
    static IntPtr Mouse(int code, IntPtr msg, IntPtr raw) {
        if (code >= 0) {
            int m = msg.ToInt32();
            if (m == 0x204 || m == 0x205 || (tracking && rightHeld && m == 0x200)) {
                var data = (MouseData)Marshal.PtrToStructure(raw, typeof(MouseData));
                if (data.extra != replayTag) {
                    if (m == 0x204 && Down(0x11) && !Down(0x12)) {
                        start = end = data.point; drawn = false; tracking = rightHeld = consumeUp = true;
                        return (IntPtr)1;
                    }
                    if (tracking && rightHeld) end = data.point;
                    if (m == 0x205 && consumeUp) {
                        rightHeld = consumeUp = false;
                        if (tracking && !IsDrag() && !drawn) {
                            tracking = false;
                            // Short Ctrl+right-click belongs to the application.
                            mouse_event(0x08, 0, 0, 0, replayTag);
                            mouse_event(0x10, 0, 0, 0, replayTag);
                        }
                        return (IntPtr)1;
                    }
                }
            }
        }
        return CallNextHookEx(hook, code, msg, raw);
    }
    static bool IsDrag() {
        var size = SystemInformation.DragSize;
        return Math.Abs(end.X-start.X) >= size.Width || Math.Abs(end.Y-start.Y) >= size.Height;
    }
    // Mouse-up freezes end; Ctrl-up alone returns a committed rectangle.
    static Rectangle? Advance(bool control, bool cancelled, Point cursor) {
        if (!tracking) return null;
        if (cancelled) { tracking = false; return null; }
        if (rightHeld) end = cursor;
        drawn |= IsDrag();
        if (control) return null;
        tracking = false;
        var rect = Selection();
        return drawn && rect.Width>=2 && rect.Height>=2 ? (Rectangle?)rect : null;
    }
    static void Tick() {
        if (!tracking) return;
        Point cursor; GetCursorPos(out cursor);
        var committed = Advance(Down(0x11), Down(0x1B) || Down(0x12), cursor);
        if (tracking && drawn && Selection().Width>=2 && Selection().Height>=2) outline.Draw(Selection());
        if (tracking) return;
        outline.Hide();
        if (!committed.HasValue) return;
        var rect = Rectangle.Intersect(committed.Value, SystemInformation.VirtualScreen);
        try {
            Bound(rect.Width,rect.Height);
            DwmFlush();
            using (var bmp = new Bitmap(rect.Width,rect.Height,PixelFormat.Format24bppRgb)) {
                using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(rect.Location,Point.Empty,rect.Size);
                EmitImage("crop",bmp,ForegroundName());
            }
        } catch { Console.WriteLine("error Region capture failed."); }
    }
    static void Bound(int w,int h) {
        if (w<=0 || h<=0 || (long)w*h>40000000) throw new ArgumentException("Capture bounds");
    }
    static string Encode(Bitmap source,int limit) {
        var scale = Math.Min(1.0,(double)limit/Math.Max(source.Width,source.Height));
        using (var bmp=new Bitmap(Math.Max(1,(int)(source.Width*scale)),Math.Max(1,(int)(source.Height*scale))))
        using (var g=Graphics.FromImage(bmp))
        using (var stream=new MemoryStream()) {
            g.InterpolationMode=InterpolationMode.HighQualityBicubic;
            g.DrawImage(source,0,0,bmp.Width,bmp.Height);
            bmp.Save(stream,ImageFormat.Jpeg);
            return Convert.ToBase64String(stream.ToArray());
        }
    }
    static string ForegroundName() {
        uint pid; GetWindowThreadProcessId(GetForegroundWindow(),out pid);
        try {
            using(var process=System.Diagnostics.Process.GetProcessById((int)pid))
                return Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(process.ProcessName));
        } catch { return ""; }
    }
    static void EmitImage(string key,Bitmap bmp,string app="") {
        Console.WriteLine(key+" "+Encode(bmp,1800)+" "+Encode(bmp,200)+" "+app);
    }
    static void Inspect(string command) {
        SetThreadDpiAwarenessContext((IntPtr)(-4));
        var p=command.Split(' ');
        if (p.Length!=4 || p[0]!="inspect") return;
        string key=p[1];
        try {
            var hwnd=new IntPtr(long.Parse(p[2])); uint pid;
            GetWindowThreadProcessId(hwnd,out pid);
            RectangleEdges box;
            if (pid!=uint.Parse(p[3]) || hwnd!=GetForegroundWindow() || !GetWindowRect(hwnd,out box)) throw new Exception();
            int w=box.right-box.left,h=box.bottom-box.top; Bound(w,h);
            using(var bmp=new Bitmap(w,h,PixelFormat.Format24bppRgb)) {
                using(var g=Graphics.FromImage(bmp)) {
                    var dc=g.GetHdc();
                    try { if(!PrintWindow(hwnd,dc,2)) throw new Exception(); }
                    finally { g.ReleaseHdc(dc); }
                }
                if(hwnd!=GetForegroundWindow()) throw new Exception();
                EmitImage(key,bmp);
            }
        } catch { Console.WriteLine(key+" unavailable"); }
    }
    public static void Run(bool capture) {
        SetProcessDpiAwarenessContext((IntPtr)(-4));
        SetThreadDpiAwarenessContext((IntPtr)(-4));
        outline = new Outline();
        var handle=outline.Handle;
        if(capture) {
            hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
            if(hook==IntPtr.Zero) throw new InvalidOperationException("Cannot monitor region gesture");
            timer=new System.Windows.Forms.Timer {Interval=12};
            timer.Tick += delegate { Tick(); }; timer.Start();
        }
        var reader=new Thread(delegate() {
            string line;
            while((line=Console.ReadLine())!=null) Inspect(line);
            outline.BeginInvoke(new Action(Application.ExitThread));
        }); reader.IsBackground=true; reader.Start();
        Console.WriteLine("ready");
        try { Application.Run(); }
        finally { if(timer!=null) timer.Stop(); if(hook!=IntPtr.Zero) UnhookWindowsHookEx(hook); outline.Dispose(); }
    }
    public static void SelfTest() {
        start=new Point(-190,490); end=new Point(-420,315);
        var expected=new Rectangle(-420,315,230,175);
        tracking=true; rightHeld=false; drawn=true;
        if(Advance(true,false,Point.Empty).HasValue || Advance(false,false,Point.Empty)!=expected ||
            Advance(false,false,Point.Empty).HasValue) throw new Exception("Mouse-up / Ctrl-up ordering");
        tracking=rightHeld=true; drawn=false;
        if(Advance(false,false,end)!=expected) throw new Exception("Ctrl-up during drag");
        tracking=true;
        if(Advance(true,true,end).HasValue || Advance(false,false,end).HasValue) throw new Exception("Escape");
        tracking=rightHeld=true; drawn=false; end=start;
        if(Advance(false,false,start).HasValue) throw new Exception("Empty selection");
        using(var bmp=new Bitmap(320,140))
        using(var g=Graphics.FromImage(bmp))
        using(var font=new Font("Segoe UI",28)) {
            g.Clear(Color.White);
            g.DrawString("Violet 726",font,Brushes.Black,4,40);
            EmitImage("crop",bmp);
        }
    }
}
