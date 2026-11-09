using System;
using System.Drawing;
using System.IO;
using System.Collections.Generic;
using System.Reflection;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Windows.Forms;

internal static class CardStyleCheck {
    [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr h,int msg,IntPtr wp,IntPtr lp);
    static void Require(bool ok,string message){if(!ok)throw new Exception(message);}
    static Bitmap Render(Card card){
        var image=new Bitmap(card.Width,card.Height);
        card.DrawToBitmap(image,card.ClientRectangle);
        Require(!card.Region.IsVisible(0,0),"Corners must follow the rounded window");
        var title=card.Controls.OfType<TextBox>().Single(t=>!t.Multiline);
        int top=title.BackColor.ToArgb();
        int bottom=card.Controls.OfType<TextBox>().Single(t=>t.Multiline).Visible?card.BackColor.ToArgb():top;
        int mid=image.Width/2;
        Require(image.GetPixel(mid,0).ToArgb()==top && image.GetPixel(mid,image.Height-1).ToArgb()==bottom,"The header and body must reach their edges");
        for(int y=0;y<image.Height;y++)for(int x=0;x<image.Width;x++)
            if(!card.Region.IsVisible(x,y))image.SetPixel(x,y,Color.Transparent);
        return image;
    }
    static void Pointer(TitleBar bar,int message,int x,int y){
        SendMessage(bar.Handle,message,(IntPtr)(message==0x201||message==0x200?1:0),(IntPtr)((y<<16)|(x&65535)));
    }
    static void TestTitle(Card card,OverlayApp app,TextBox body){
        var bar=card.Controls.OfType<TitleBar>().Single();
        var title=card.Controls.OfType<TextBox>().Single(t=>!t.Multiline);
        Require(bar.Width>card.Width*.75,"Title should use the header space");
        Require(!card.Controls.OfType<Button>().Any(b=>b.Text=="#"),"Visible grip must be removed");
        var rows=new Dictionary<int,Point>{{1,new Point(card.Left-200,card.Top+12)},{2,new Point(card.Left-200,card.Top+44)}};
        typeof(OverlayApp).GetField("rows",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(app,rows);
        var output=new StringWriter();var previous=Console.Out;Console.SetOut(output);
        try{
            foreach(bool collapsed in new[]{false,true}){
                bool wasOpen=body.Visible;
                Require(wasOpen!=collapsed,"Initial fold state");
                Point start=card.Location;
                Pointer(bar,0x201,22,8);
                Pointer(bar,0x200,62,40);
                Require(card.Dragging && card.Location==start+new Size(40,32),"Threshold must start native drag");
                Pointer(bar,0x202,22,8);
                string updates=output.ToString();
                Require(body.Visible==wasOpen && !card.Dragging && !updates.Contains("collapsed") && updates.Contains("\"line\":") && updates.Contains("\"active\":false"),"Drop must save a position without toggling");
                output.GetStringBuilder().Clear();
                Pointer(bar,0x201,22,8);Pointer(bar,0x200,23,8);Pointer(bar,0x202,23,8);
                Require(body.Visible!=wasOpen && output.ToString().Contains("collapsed") && !output.ToString().Contains("drag"),"Click must toggle exactly once");
                output.GetStringBuilder().Clear();
            }
            var origin=card.Location;
            Pointer(bar,0x201,22,8);Pointer(bar,0x200,42,12);
            SendMessage(bar.Handle,0x1f,IntPtr.Zero,IntPtr.Zero);
            Require(card.Location==origin && body.Visible && !card.Dragging && !output.ToString().Contains("\"line\":"),"Cancelled drag must restore position");
            output.GetStringBuilder().Clear();
            string original=bar.AccessibleName;
            Pointer(bar,0x204,22,8);Pointer(bar,0x205,22,8);
            Require(title.Visible,"Right-click opens the title editor");
            title.Text="New title";
            SendMessage(title.Handle,0x100,(IntPtr)Keys.Enter,IntPtr.Zero);
            Require(!title.Visible && bar.AccessibleName=="New title" && output.ToString().Contains("New title"),"Rename commits");
            SendMessage(bar.Handle,0x100,(IntPtr)Keys.F2,IntPtr.Zero);
            title.Text="Discard";
            SendMessage(title.Handle,0x100,(IntPtr)Keys.Escape,IntPtr.Zero);
            Require(!title.Visible && bar.AccessibleName=="New title" && !output.ToString().Contains("Discard"),"Rename cancels");
            SendMessage(bar.Handle,0x100,(IntPtr)Keys.F2,IntPtr.Zero);
            title.Text=original;
            SendMessage(title.Handle,0x100,(IntPtr)Keys.Enter,IntPtr.Zero);
        } finally {Console.SetOut(previous);}
    }
    static void CheckIdleButton(Button button,Control editor){
        editor.FindForm().Activate();editor.Focus();Application.DoEvents();
        Require(editor.Focused && !button.Focused,"Focus must have returned to the editor");
        using(var pixels=new Bitmap(button.Width,button.Height)){
            button.DrawToBitmap(pixels,button.ClientRectangle);
            Color actual=pixels.GetPixel(button.Width/2,0);
            Require(actual.ToArgb()==button.BackColor.ToArgb(),"Inactive "+button.AccessibleName+" has an outline: "+actual);
        }
    }
    static void TestFocusExit(Card card,Form owner){
        owner.StartPosition=FormStartPosition.Manual;owner.Location=new Point(-6000,-6000);
        var editor=new TextBox();owner.Controls.Add(editor);owner.Show();
        var bar=card.Controls.OfType<TitleBar>().Single();
        foreach(bool collapsed in new[]{true,false}){
            card.Activate();
            Pointer(bar,0x201,22,8);Pointer(bar,0x202,22,8);
            Require(bar.Focused && (card.Height<45)==collapsed,"Click the active annotation title");
            CheckIdleButton(bar,editor);
        }
        foreach(var b in card.Controls.OfType<Button>().Where(b=>b!=bar)){
            card.Activate();Require(b.Focus(),"Button must accept keyboard focus");
            CheckIdleButton(b,editor);
        }
    }
    [STAThread]static void Main(string[] args){
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var app=(OverlayApp)FormatterServices.GetUninitializedObject(typeof(OverlayApp));
        typeof(OverlayApp).GetProperty("ClientBounds").SetValue(app,new Rectangle(-5000,-5000,1200,800),null);
        var n=new Note{id="test",title="Step 3",body="Round each session up to the next multiple of six. Two one-minute sessions count as twelve minutes.",width=284,x=.62};
        var style=new Snapshot{fontFamily="Missing QA Font, 'Courier New', monospace",fontSize=16,dark=true};
        using(var owner=new Form())using(var card=new Card(app,"qa",n,true)){
            card.Present(n,new Point(-4990,-4900),owner.Handle,style);
            var text=card.Controls.OfType<TextBox>().Single(t=>t.Multiline);
            Require(text.Font.Name=="Courier New"&&text.Font.Size==16,"Wrong resolved font");
            Require(text.ScrollBars==ScrollBars.None,"Native scrollbar present");
            using(var image=Render(card)){image.Save(args[0]);}
            TestTitle(card,app,text);
            TestFocusExit(card,owner);
            var fold=card.Controls.OfType<TitleBar>().Single();
            fold.PerformClick();Require(card.Height<45,"Collapse failed");
            using(var image=Render(card)){}
            fold.PerformClick();text.Text=String.Join(Environment.NewLine,Enumerable.Range(0,120).Select(i=>"Line "+i));
            SendMessage(text.Handle,0x00B6,IntPtr.Zero,(IntPtr)(-150));
            int before=(int)SendMessage(text.Handle,0x00CE,IntPtr.Zero,IntPtr.Zero);
            SendMessage(text.Handle,0x020A,(IntPtr)(-120<<16),IntPtr.Zero);
            Require((int)SendMessage(text.Handle,0x00CE,IntPtr.Zero,IntPtr.Zero)>before,"Wheel failed to scroll long text");
            style.fontSize=18;style.fontFamily="Consolas";
            card.Present(n,new Point(-4990,-4900),owner.Handle,style);
            Require(text.Font.Name=="Consolas" && text.Font.Size==18,"Font refresh failed");
            Console.WriteLine("Passed sharp borderless native card, collapse, editor font, hidden scrollbar and wheel scrolling.");
        }
    }
}
