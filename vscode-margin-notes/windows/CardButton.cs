using System.Windows.Forms;

internal class CardButton : Button {
    // The form remembers its default action after focus returns to the editor.
    // Use the normal keyboard focus cue without that persistent default outline.
    public override void NotifyDefault(bool value){
        base.NotifyDefault(false);
    }
}
