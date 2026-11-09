using System;
using System.Drawing;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Automation;

// Read only the rectangles of the native editor groups. Run UI Automation on a
// worker thread so a busy Code window never blocks typing in a note.
internal sealed class EditorBounds {
    readonly object gate=new object();
    IntPtr requested;
    Rectangle[] boxes=new Rectangle[0];
    bool running;
    DateTime last;
    public Rectangle[] Get(IntPtr hwnd){
        lock(gate){
            if(hwnd!=requested){requested=hwnd;boxes=new Rectangle[0];last=DateTime.MinValue;}
            if(!running && (DateTime.UtcNow-last).TotalMilliseconds>550){
                running=true;last=DateTime.UtcNow;
                Task.Run(()=>Read(hwnd));
            }
            return boxes;
        }
    }
    void Read(IntPtr hwnd){
        var result=new List<Rectangle>();
        try{
            var root=AutomationElement.FromHandle(hwnd);
            var elements=root.FindAll(TreeScope.Descendants,new PropertyCondition(AutomationElement.ClassNameProperty,"editor-instance"));
            foreach(AutomationElement el in elements){
                var r=el.Current.BoundingRectangle;
                if(!r.IsEmpty && r.Width>60 && r.Height>20)result.Add(Rectangle.FromLTRB((int)r.Left,(int)r.Top,(int)r.Right,(int)r.Bottom));
            }
        }catch(ElementNotAvailableException){}catch(System.Runtime.InteropServices.COMException){}catch(InvalidOperationException){}
        finally{lock(gate){if(requested==hwnd)boxes=result.ToArray();running=false;}}
    }
}
