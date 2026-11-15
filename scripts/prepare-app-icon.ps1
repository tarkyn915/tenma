param(
  [string]$Source = (Join-Path $PSScriptRoot '..\assets\tenma-icon-source.jpg'),
  [string]$Output = (Join-Path $PSScriptRoot '..\assets\tenma-icon.png'),
  [string]$Preview = (Join-Path $env:TEMP 'tenma-icon-edge-preview.png')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
# This crop is calibrated to the owner's 2048px source. The threshold traces only
# the OUTER light tile, not the pale areas or eyes inside the illustration.
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
public static class TenmaIconCrop {
  public static void Run(string source, string output, string preview) {
    using (var image = new Bitmap(source)) {
      if (image.Width != 2048 || image.Height != 2048) throw new Exception("Expected the original 2048x2048 image.");
      var left = new Dictionary<int, int>();
      var right = new Dictionary<int, int>();
      int top = -1, bottom = -1;
      for (int y = 430; y <= 1620; y++) {
        int l = -1, r = -1;
        for (int x = 420; x <= 1630; x++) {
          var c = image.GetPixel(x, y);
          if (c.R >= 234 && c.G >= 246 && c.B >= 248) { if (l < 0) l = x; r = x; }
        }
        if (l < 0 || r - l < 100) continue;
        if (top < 0) top = y;
        bottom = y; left[y] = l; right[y] = r;
      }
      if (top < 430 || bottom < 1600) throw new Exception("Unable to identify the rounded icon tile.");
      // Inset 3px into the solid tile to discard JPEG edge contamination/shadow.
      // A short moving average removes 1px compression jaggies in the mask.
      var outline = new List<PointF>();
      for (int y = top + 3; y <= bottom - 3; y++) outline.Add(new PointF(Smooth(left, y, top, bottom) + 3, y));
      for (int y = bottom - 3; y >= top + 3; y--) outline.Add(new PointF(Smooth(right, y, top, bottom) - 3, y));
      using (var path = new GraphicsPath()) {
        path.AddPolygon(outline.ToArray());
        var bounds = path.GetBounds();
        float size = Math.Max(bounds.Width, bounds.Height);
        float cx = bounds.Left + bounds.Width / 2, cy = bounds.Top + bounds.Height / 2;
        // Tight square master: no arbitrary outer padding. Transparent rounded corners.
        var sourceRect = new RectangleF(cx - size / 2, cy - size / 2, size, size);
        using (var result = new Bitmap(1024, 1024, PixelFormat.Format32bppArgb))
        using (var mask = new Bitmap(1024, 1024, PixelFormat.Format32bppArgb)) {
          using (var g = Graphics.FromImage(result)) {
            g.CompositingMode = CompositingMode.SourceCopy;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(image, new RectangleF(0,0,1024,1024), sourceRect, GraphicsUnit.Pixel);
          }
          using (var transform = new Matrix()) {
            transform.Translate(-sourceRect.Left, -sourceRect.Top, MatrixOrder.Append);
            transform.Scale(1024 / size, 1024 / size, MatrixOrder.Append);
            path.Transform(transform);
          }
          using (var g = Graphics.FromImage(mask)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.FillPath(Brushes.White, path);
          }
          for (int y = 0; y < 1024; y++) for (int x = 0; x < 1024; x++) {
            var c = result.GetPixel(x,y); int a = mask.GetPixel(x,y).A;
            result.SetPixel(x,y, a == 0 ? Color.Transparent : Color.FromArgb(a,c.R,c.G,c.B));
          }
          result.Save(output, ImageFormat.Png);
          using (var sheet = new Bitmap(1200, 730, PixelFormat.Format32bppArgb))
          using (var g = Graphics.FromImage(sheet)) {
            g.Clear(Color.FromArgb(32,36,43));
            using (var font = new Font("Segoe UI", 15)) {
              g.DrawString("Transparent master on dark / light backgrounds",font,Brushes.White,24,16);
              g.FillRectangle(Brushes.White,610,60,560,560);
              g.InterpolationMode = InterpolationMode.HighQualityBicubic;
              g.DrawImage(result, new Rectangle(30,60,560,560));
              g.DrawImage(result, new Rectangle(610,60,560,560));
              int x=30;
              foreach (int px in new int[]{16,24,32,48,64}) {
                g.DrawImage(result,new Rectangle(x,650,px,px));
                g.DrawString(px+"px",font,Brushes.White,x,620);
                x += 140;
              }
            }
            sheet.Save(preview,ImageFormat.Png);
          }
          Console.WriteLine("Tile source bounds: " + sourceRect + "; trace rows " + top + ".." + bottom);
        }
      }
    }
  }
  static float Smooth(Dictionary<int,int> values, int y, int top, int bottom) {
    float total=0; int count=0;
    for(int row=Math.Max(top,y-2);row<=Math.Min(bottom,y+2);row++){total+=values[row];count++;}
    return total/count;
  }
}
'@
$outputPath = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Preview)) | Out-Null
[TenmaIconCrop]::Run($Source, $outputPath, $Preview)
"MASTER=$outputPath"
"PREVIEW=$Preview"
