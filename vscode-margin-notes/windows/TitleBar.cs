using System;
using System.Drawing;
using System.Windows.Forms;

// The title remains a keyboard-accessible button. Own its left-pointer gesture
// so a completed drag cannot also produce the button's standard click.
internal sealed class TitleBar : CardButton {
    public event Action DragStarted;
    public event Action<Size> Dragged;
    public event Action<bool> DragFinished;
    bool pressed,dragged;
    Point pressAt;
    Rectangle clickArea;
    const int WmMouseMove=0x200,LeftDown=0x201,LeftUp=0x202,LeftDoubleClick=0x203;
    const int CaptureChanged=0x215,CancelMode=0x1f;

    protected override void WndProc(ref Message m){
        if(m.Msg==LeftDown || m.Msg==LeftDoubleClick){
            if(!pressed){
                Focus();
                pressAt=PointToScreen(MousePoint(m.LParam));
                Size threshold=SystemInformation.DragSize;
                clickArea=new Rectangle(pressAt.X-threshold.Width/2,pressAt.Y-threshold.Height/2,threshold.Width,threshold.Height);
                pressed=true;
                Capture=true;
            }
            return;
        }
        if(pressed && (m.Msg==WmMouseMove || m.Msg==LeftUp)){
            Point local=MousePoint(m.LParam),screen=PointToScreen(local);
            if(!dragged && !clickArea.Contains(screen)){
                dragged=true;
                if(DragStarted!=null)DragStarted();
            }
            if(dragged && Dragged!=null)Dragged(new Size(screen.X-pressAt.X,screen.Y-pressAt.Y));
            if(m.Msg==LeftUp){
                bool click=!dragged && ClientRectangle.Contains(local);
                EndPress(true);
                if(click)PerformClick();
            }
            return;
        }
        if(pressed && (m.Msg==CaptureChanged || m.Msg==CancelMode))EndPress(false);
        base.WndProc(ref m);
    }
    static Point MousePoint(IntPtr packed){
        int xy=unchecked((int)packed.ToInt64());
        return new Point(unchecked((short)xy),unchecked((short)(xy>>16)));
    }
    void EndPress(bool dropped){
        bool wasDrag=dragged;
        pressed=dragged=false;
        if(Capture)Capture=false;
        if(wasDrag && DragFinished!=null)DragFinished(dropped);
    }
}
