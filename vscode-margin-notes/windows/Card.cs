using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Runtime.InteropServices;

internal sealed class Card : Form {
    readonly OverlayApp app;readonly string uri,id;
    readonly TitleBar fold=new TitleBar();
    readonly CardButton remove=new CardButton(),resize=new CardButton();
    readonly TextBox title=new TextBox(),body=new NoteBody();readonly ToolTip tips=new ToolTip();
    Font noteFont;
    string requestedFamily;
    float requestedPixels;
    Color headerColor;
    bool dark,collapsed,loading=true,confirmDelete,moving,resizing,renaming;
    string savedTitle;
    int line,initialWidth,header,headerY,anchorY;Point start,origin;
    public bool Dragging{get{return moving||resizing;}}
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x80;return p;}}
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd,int msg,IntPtr wp,string text);
    public Card(OverlayApp app,string uri,Note n,bool dark){
        this.app=app;this.uri=uri;id=n.id;
        Name="MarginNotesCard";Text="Margin Notes";FormBorderStyle=FormBorderStyle.None;
        ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;AutoScaleMode=AutoScaleMode.None;
        Padding=new Padding(1);DoubleBuffered=true;
        remove.Text="×";resize.Cursor=Cursors.SizeWE;
        fold.UseMnemonic=false;fold.AutoEllipsis=true;
        foreach(var b in new Button[]{fold,remove,resize}){
            b.FlatStyle=FlatStyle.Flat;b.FlatAppearance.BorderSize=0;b.TabStop=true;
            b.UseVisualStyleBackColor=false;Controls.Add(b);
        }
        title.AccessibleName="Optional title";body.AccessibleName="Annotation text";
        fold.AccessibleDescription="Click to collapse or expand. Drag to move. Press F2 to rename.";
        remove.AccessibleName="Delete annotation";resize.AccessibleName="Resize annotation";
        title.BorderStyle=BorderStyle.None;body.BorderStyle=BorderStyle.None;body.Multiline=true;
        body.AcceptsReturn=true;body.WordWrap=true;body.ScrollBars=ScrollBars.None;
        Controls.Add(title);Controls.Add(body);
        title.Text=savedTitle=n.title??"";body.Text=n.body??"";collapsed=n.collapsed;
        tips.SetToolTip(fold,"Click to fold • Drag to move • Right-click or F2 to rename");tips.SetToolTip(resize,"Drag to resize");
        tips.SetToolTip(remove,"Delete annotation");
        title.HandleCreated+=(s,e)=>SendMessage(title.Handle,0x1501,IntPtr.Zero,"Title (optional)");
        title.Leave+=(s,e)=>FinishRename(true);
        title.KeyDown+=(s,e)=>{
            if(e.KeyCode!=Keys.Enter && e.KeyCode!=Keys.Escape)return;
            e.SuppressKeyPress=true;FinishRename(e.KeyCode==Keys.Enter);fold.Focus();
        };
        fold.MouseUp+=(s,e)=>{if(e.Button==MouseButtons.Right)BeginRename();};
        fold.KeyDown+=(s,e)=>{if(e.KeyCode==Keys.F2){e.SuppressKeyPress=true;BeginRename();}};
        body.TextChanged+=(s,e)=>{if(!loading){Patch(new{body=body.Text});Arrange();}};
        fold.Click+=(s,e)=>{collapsed=!collapsed;Patch(new{collapsed});Arrange();};
        remove.Click+=(s,e)=>{
            if(confirmDelete || (body.Text.Length==0 && title.Text.Length==0)){OverlayApp.Send(new{type="delete",uri,id});return;}
            confirmDelete=true;remove.Text="✓";tips.SetToolTip(remove,"Confirm deletion");
        };
        remove.Leave+=(s,e)=>{confirmDelete=false;remove.Text="×";tips.SetToolTip(remove,"Delete annotation");};
        fold.DragStarted+=()=>{origin=Location;moving=true;OverlayApp.Send(new{type="drag",active=true});};
        fold.Dragged+=delta=>Location=origin+delta;
        fold.DragFinished+=FinishMove;
        SetArrowKeys(fold,true);SetArrowKeys(resize,false);SetResize();SetTheme(dark);loading=false;
    }
    void BeginRename(){
        renaming=true;title.Text=savedTitle;Arrange();title.Focus();title.SelectAll();
    }
    void FinishRename(bool commit){
        if(!renaming)return;
        renaming=false;
        if(commit && title.Text!=savedTitle){savedTitle=title.Text;Patch(new{title=savedTitle});}
        title.Text=savedTitle;Arrange();
    }
    void Patch(object data){OverlayApp.Send(new{type="patch",uri,id,patch=data});}
    void SetEditorFont(string familyList,double size,double scale){
        float pixels=(float)Math.Max(6,Math.Min(160,size*scale));
        if(noteFont!=null && requestedFamily==familyList && requestedPixels==pixels)return;
        Font next=null;
        foreach(string token in (familyList??"").Split(',')){
            string name=token.Trim().Trim('\'','"');
            if(name.Length==0)continue;
            if(name.Equals("monospace",StringComparison.OrdinalIgnoreCase))break;
            try{
                using(var family=new FontFamily(name)){
                    if(!family.IsStyleAvailable(FontStyle.Regular))continue;
                    next=new Font(family,pixels,FontStyle.Regular,GraphicsUnit.Pixel);
                }
                break;
            }catch(ArgumentException){ /* Try the next installed family in the editor's font list. */ }
        }
        if(next==null)next=new Font(FontFamily.GenericMonospace,pixels,FontStyle.Regular,GraphicsUnit.Pixel);
        Font previous=noteFont;Font=noteFont=next;
        requestedFamily=familyList;requestedPixels=pixels;
        if(previous!=null)previous.Dispose();
    }
    void SetTheme(bool value){
        dark=value;
        BackColor=value?Color.FromArgb(30,30,30):Color.FromArgb(250,250,250);
        ForeColor=value?Color.FromArgb(250,250,250):Color.FromArgb(30,30,30);
        headerColor=value?Color.FromArgb(47,47,47):Color.FromArgb(237,239,242);
        foreach(Control c in Controls){c.BackColor=BackColor;c.ForeColor=ForeColor;}
        foreach(Control c in new Control[]{fold,title,remove})c.BackColor=headerColor;
        remove.ForeColor=value?Color.FromArgb(185,185,185):Color.FromArgb(80,80,80);
        Color hover=value?Color.FromArgb(63,64,66):Color.FromArgb(220,225,232);
        foreach(Button b in new Button[]{fold,remove})b.FlatAppearance.MouseOverBackColor=hover;
    }
    void Arrange(){
        int pad=Math.Max(5,Font.Height/2);
        int edge=Math.Max(8,pad);
        header=Math.Max(Font.Height+6,24);
        fold.TextAlign=ContentAlignment.MiddleLeft;
        string summary=savedTitle;
        if(String.IsNullOrWhiteSpace(summary))summary=collapsed?body.Text.Trim().Split('\n')[0].Trim():"";
        if(String.IsNullOrWhiteSpace(summary))summary="Annotation";
        fold.Text=(collapsed?"▸ ":"▾ ")+summary;
        fold.AccessibleName=summary;
        body.Visible=resize.Visible=!collapsed;
        title.Visible=renaming;fold.Visible=!renaming;
        int w=Math.Max(20,Width-pad-edge-3);
        int measured=TextRenderer.MeasureText(body.Text.Length==0?" ":body.Text,Font,new Size(w,20000),TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl|TextFormatFlags.NoPrefix|TextFormatFlags.NoPadding).Height;
        int height=Math.Min(Math.Max(Font.Height+4,measured+6),Math.Max(60,app.ClientBounds.Height/2));
        Height=collapsed?header+2:header+height+pad+4;
        bool above=!collapsed && anchorY+Height-header/2>app.ClientBounds.Bottom && anchorY-app.ClientBounds.Top>app.ClientBounds.Bottom-anchorY;
        headerY=above?Height-header-1:1;
        int inset=CornerRadius;
        remove.SetBounds(Width-header-inset,headerY,header,header);
        fold.SetBounds(inset,headerY,Math.Max(1,remove.Left-inset),header);
        title.SetBounds(inset,headerY+Math.Max(0,(header-Font.Height)/2),fold.Width,Font.Height+2);
        body.SetBounds(1+pad,above?pad:header+4,w,height);
        resize.SetBounds(Width-edge-1,above?inset:header+1,edge,Math.Max(0,Height-header-inset-1));Invalidate();
    }
    public void Present(Note n,Point anchor,IntPtr owner,Snapshot state){
        if(Dragging)return;
        if(dark!=state.dark)SetTheme(state.dark);
        line=n.line;anchorY=anchor.Y;
        var area=app.ClientBounds;
        double scale=Math.Max(1,Native.GetDpiForWindow(owner)/96.0);
        SetEditorFont(state.fontFamily,state.fontSize,scale);
        int left=anchor.X+(int)(16*scale),min=Math.Min((int)(135*scale),Math.Max(1,area.Right-left-2)),available=area.Right-left-4;
        int x=left+(int)(Math.Max(0,available-min)*Math.Min(1,Math.Max(0,n.x)));
        Width=Math.Max(min,Math.Min((int)(n.width*scale),area.Right-x-2));
        Arrange();
        Location=new Point(x,anchor.Y-headerY-header/2);
        if(!Visible)Show(new WindowHandle(owner));
    }
    public void Edit(){Activate();if(collapsed)fold.Focus();else body.Focus();}
    const int CornerRadius=8;
    static GraphicsPath Outline(float width,float height){
        float d=Math.Min(2*CornerRadius,Math.Min(width,height));
        var p=new GraphicsPath();
        p.AddArc(0,0,d,d,180,90);
        p.AddArc(width-d,0,d,d,270,90);
        p.AddArc(width-d,height-d,d,d,0,90);
        p.AddArc(0,height-d,d,d,90,90);
        p.CloseFigure();
        return p;
    }
    protected override void OnSizeChanged(EventArgs e){
        base.OnSizeChanged(e);
        if(Width<2||Height<2)return;
        using(var p=Outline(Width,Height))Region=new Region(p);
    }
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);
        using(var fill=new SolidBrush(headerColor))
            e.Graphics.FillRectangle(fill,0,headerY-1,Width,header+2);
    }
    void SetArrowKeys(Button handle,bool move){
        handle.PreviewKeyDown+=(s,e)=>{
            if(e.KeyCode==Keys.Left||e.KeyCode==Keys.Right||e.KeyCode==Keys.Up||e.KeyCode==Keys.Down)e.IsInputKey=true;
        };
        handle.KeyDown+=(s,e)=>{
            int dx=e.KeyCode==Keys.Right?1:e.KeyCode==Keys.Left?-1:0;
            int dy=e.KeyCode==Keys.Down?1:e.KeyCode==Keys.Up?-1:0;
            if(dx==0&&dy==0)return;
            e.Handled=true;e.SuppressKeyPress=true;
            double scale=Math.Max(1,Native.GetDpiForWindow(Handle)/96.0);
            if(!move){if(dx!=0)Patch(new{width=Width/scale+dx*12});return;}
            int left=app.GutterLeft+(int)(16*scale);
            double relative=(Left+dx*12*scale-left)/Math.Max(1,app.ClientBounds.Right-left-(int)(135*scale)-4);
            Patch(new{line=line+dy,x=Math.Max(0,Math.Min(1,relative))});
        };
    }
    void FinishMove(bool dropped){
        if(dropped){
            int dest=app.DropLine(Top+headerY+header/2,line);
            double scale=Math.Max(1,Native.GetDpiForWindow(Handle)/96.0);
            int left=app.GutterLeft+(int)(16*scale);
            double x=(Left-left)/(double)Math.Max(1,app.ClientBounds.Right-left-(int)(135*scale)-4);
            Patch(new{line=dest,x=Math.Max(0,Math.Min(1,x))});
        }else Location=origin;
        moving=false;
        OverlayApp.Send(new{type="drag",active=false});
    }
    void SetResize(){
        resize.MouseDown+=(s,e)=>{
            if(e.Button!=MouseButtons.Left)return;
            resizing=true;start=Cursor.Position;initialWidth=Width;resize.Capture=true;
        };
        resize.MouseMove+=(s,e)=>{
            if(!resize.Capture||!resizing)return;
            Point p=Cursor.Position;
            Width=Math.Max(135,Math.Min(initialWidth+p.X-start.X,app.ClientBounds.Right-Left));Arrange();
        };
        resize.MouseUp+=(s,e)=>{
            if(!resizing || e.Button!=MouseButtons.Left)return;
            resize.Capture=false;
        };
        resize.MouseCaptureChanged+=(s,e)=>{
            if(resize.Capture || !resizing)return;
            resizing=false;
            Patch(new{width=Width*96.0/Math.Max(96,Native.GetDpiForWindow(Handle))});
        };
    }
    protected override void Dispose(bool disposing){if(disposing)tips.Dispose();base.Dispose(disposing);if(disposing && noteFont!=null)noteFont.Dispose();}
}
