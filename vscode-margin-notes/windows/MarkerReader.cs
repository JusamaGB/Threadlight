using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Windows.Forms;

internal static class Native {
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int left,top,right,bottom; }
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] internal static extern int GetWindowThreadProcessId(IntPtr window,out int pid);
    [DllImport("user32.dll")] internal static extern bool GetClientRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] internal static extern bool ClientToScreen(IntPtr window,ref Point pt);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] internal static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] internal static extern bool BitBlt(IntPtr dst,int dx,int dy,int w,int h,IntPtr src,int sx,int sy,int rop);
    internal static Rectangle Bounds(IntPtr window) {
        Rect r; Point origin=Point.Empty;
        GetClientRect(window,out r);ClientToScreen(window,ref origin);
        return new Rectangle(origin.X,origin.Y,r.right-r.left,r.bottom-r.top);
    }
    internal static IntPtr ForegroundEditor(int expectedPid) {
        IntPtr hwnd=GetAncestor(GetForegroundWindow(),3);int pid;
        if(hwnd==IntPtr.Zero||IsIconic(hwnd))return IntPtr.Zero;
        GetWindowThreadProcessId(hwnd,out pid);
        if(expectedPid>0 && expectedPid!=pid)return IntPtr.Zero;
        try {if(!Process.GetProcessById(pid).ProcessName.StartsWith("Code",StringComparison.OrdinalIgnoreCase))return IntPtr.Zero;}
        catch{return IntPtr.Zero;}
        return hwnd;
    }
}

// Match two adjacent colour blocks emitted by this extension. Read only the
// foreground Code window's client surface. No bitmap leaves this method.
internal sealed class MarkerReader {
    int column=-1;
    readonly Dictionary<Rectangle,long> nextWide=new Dictionary<Rectangle,long>();
    public Dictionary<int,Point> Read(IntPtr hwnd, Rectangle bounds, Snapshot state) {
        var empty=new Dictionary<int,Point>();
        if(bounds.Width<=0||bounds.Height<=0||state.markers.Length==0)return empty;
        if(column>=0 && column<bounds.Width) {
            int x=Math.Max(0,column-8);
            var found=Scan(hwnd,bounds,new Rectangle(x,0,Math.Min(32,bounds.Width-x),bounds.Height),state);
            if(found.Count>0)return found;
        }
        long now=Stopwatch.GetTimestamp();
        long next;
        if(nextWide.TryGetValue(bounds,out next) && now<next)return empty;
        if(nextWide.Count>20)nextWide.Clear();
        nextWide[bounds]=now+Stopwatch.Frequency/2;
        var all=Scan(hwnd,bounds,new Rectangle(0,0,Math.Min(96,bounds.Width),bounds.Height),state);
        foreach(var p in all.Values){column=p.X-bounds.Left;break;}
        return all;
    }
    static unsafe Dictionary<int,Point> Scan(IntPtr hwnd, Rectangle client, Rectangle part,Snapshot state) {
        var found=new Dictionary<int,Point>();
        var colors=new Dictionary<int,int>();
        foreach(var m in state.markers)colors[m.color]=m.line;
        using(var bitmap=new Bitmap(part.Width,part.Height,System.Drawing.Imaging.PixelFormat.Format32bppRgb)){
            using(var g=Graphics.FromImage(bitmap)){
                // Chromium composites the editor on the GPU. Its window DC can
                // be blank, so sample the *visible* client rectangle instead.
                IntPtr dst=g.GetHdc(),src=Native.GetDC(IntPtr.Zero);
                try { if(src==IntPtr.Zero || !Native.BitBlt(dst,0,0,part.Width,part.Height,src,client.Left+part.X,client.Top+part.Y,0x00CC0020))return found;}
                finally {if(src!=IntPtr.Zero)Native.ReleaseDC(IntPtr.Zero,src);g.ReleaseHdc(dst);}
            }
            var bits=bitmap.LockBits(new Rectangle(0,0,part.Width,part.Height),System.Drawing.Imaging.ImageLockMode.ReadOnly,bitmap.PixelFormat);
            try {
                for(int y=0;y<part.Height;y++){
                    int* row=(int*)((byte*)bits.Scan0+y*bits.Stride);
                    for(int x=0;x<part.Width-1;x++){
                        if((row[x]&0xffffff)!=state.prefix)continue;
                        int start=x;
                        while(x+1<part.Width && (row[x+1]&0xffffff)==state.prefix)x++;
                        for(int j=x+1;j<Math.Min(part.Width,x+7);j++){
                            int line;
                            if(!colors.TryGetValue(row[j]&0xffffff,out line))continue;
                            if(!found.ContainsKey(line)){
                                Point point=new Point(client.Left+part.X+start,client.Top+part.Y+y+2);
                                if(Native.GetAncestor(Native.WindowFromPoint(point),2)==hwnd)found[line]=point;
                            }
                            break;
                        }
                    }
                }
            }finally{bitmap.UnlockBits(bits);}
        }
        return found;
    }
}
