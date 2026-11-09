using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class Note { public string id,title,body; public int line; public double x,width; public bool collapsed; }
public sealed class Mark { public int color,line; }
public sealed class Snapshot { public string uri,focus,fontFamily; public double fontSize; public Note[] cards; public Mark[] markers; public int prefix,pid; public bool dark,active; }
internal sealed class WindowHandle : IWin32Window {public IntPtr Handle{get;private set;}public WindowHandle(IntPtr h){Handle=h;}}

internal sealed class OverlayApp : ApplicationContext {
    readonly Control dispatcher=new Control();
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly MarkerReader reader=new MarkerReader();
    readonly EditorBounds editorBounds=new EditorBounds();
    readonly Dictionary<string,Card> windows=new Dictionary<string,Card>();
    Snapshot state;
    IntPtr owner;
    string focused;
    string requested;
    DateTime requestTime;
    Dictionary<int,Point> rows=new Dictionary<int,Point>();
    public Rectangle ClientBounds {get;private set;}
    public int DropLine(int y,int fallback){
        if(rows.Count==0)return fallback;
        return rows.OrderBy(pair=>Math.Abs(pair.Value.Y-y)).First().Key;
    }
    public int GutterLeft {
        get{return rows.Count>0?rows.First().Value.X:ClientBounds.Left;}
    }
    public static void Send(object message){
        Console.WriteLine(new JavaScriptSerializer().Serialize(message));Console.Out.Flush();
    }
    public OverlayApp(){
        dispatcher.CreateControl();
        timer.Interval=65;timer.Tick+=(s,e)=>Tick();timer.Start();
        var input=new Thread(ReadInput);input.IsBackground=true;input.Start();
    }
    void ReadInput(){
        var json=new JavaScriptSerializer{MaxJsonLength=int.MaxValue};
        try {
            string line;while((line=Console.ReadLine())!=null){
                var snap=json.Deserialize<Snapshot>(line);
                dispatcher.BeginInvoke(new Action(()=>{state=snap;if(String.IsNullOrEmpty(snap.focus))focused=null;Tick();}));
            }
        } finally {if(!dispatcher.IsDisposed)dispatcher.BeginInvoke(new Action(ExitThread));}
    }
    void Tick(){
        if(state==null)return;
        var visibleIds=new HashSet<string>(state.cards.Select(n=>n.id));
        foreach(string id in windows.Keys.Where(k=>!visibleIds.Contains(k)).ToArray()){
            windows[id].Dispose();windows.Remove(id);
        }
        if(state.cards.Length==0)return;
        bool cardHasFocus=windows.Values.Any(c=>c.IsHandleCreated && c.Handle==Native.GetForegroundWindow());
        // WinForms owned tool windows can report themselves as GA_ROOTOWNER.
        // Keep using the known Code window while one of our cards has focus.
        IntPtr hwnd=cardHasFocus?owner:Native.ForegroundEditor(state.pid);
        if(hwnd==IntPtr.Zero || (!state.active && !cardHasFocus)){foreach(var c in windows.Values)c.Hide();return;}
        if(requested!=state.focus){requested=state.focus;requestTime=DateTime.UtcNow;}
        owner=hwnd;var views=editorBounds.Get(hwnd);
        rows=new Dictionary<int,Point>();
        foreach(var box in views.OrderByDescending(b=>b==ClientBounds)){
            var bounds=Rectangle.Intersect(box,Native.Bounds(hwnd));if(bounds.IsEmpty)continue;
            var found=reader.Read(hwnd,bounds,state);if(found.Count==0)continue;
            rows=found;ClientBounds=bounds;break;
        }
        foreach(var n in state.cards){
            Card c;windows.TryGetValue(n.id,out c);
            Point anchor;
            if(!rows.TryGetValue(n.line,out anchor)){if(c!=null&&!c.Dragging)c.Hide();continue;}
            if(c==null){c=new Card(this,state.uri,n,state.dark);windows.Add(n.id,c);}
            c.Present(n,anchor,owner,state);
            if(n.id==state.focus && focused!=n.id){
                focused=n.id;c.Edit();Send(new{type="focused",id=n.id});
            }
        }
        if(!String.IsNullOrEmpty(requested) && requested!=focused && (DateTime.UtcNow-requestTime).TotalSeconds>6){
            focused=requested;Send(new{type="unlocated",id=requested});
        }
    }
    protected override void ExitThreadCore(){
        timer.Stop();foreach(var c in windows.Values)c.Dispose();dispatcher.Dispose();base.ExitThreadCore();
    }
}
internal static class Program {
    [STAThread] static void Main(){
        try{Native.SetProcessDpiAwarenessContext(new IntPtr(-4));}catch(EntryPointNotFoundException){}
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OverlayApp());
    }
}
