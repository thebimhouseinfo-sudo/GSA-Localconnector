import fs from "node:fs/promises";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

// Local AppKit drawing is a navy/teal adaptation of the vendored Lucide SVG.
// Geometry follows plug-zap.svg; no runtime assets or packages are downloaded.
const drawing = String.raw`
import AppKit
import Foundation
let directory = CommandLine.arguments[1]
func draw(_ size: Int, _ variant: String) throws {
    let s = CGFloat(size)
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()
    if variant == "badge" {
        NSColor(calibratedRed: 0.055, green: 0.10, blue: 0.19, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: s * 0.055, y: s * 0.055, width: s * 0.89, height: s * 0.89), xRadius: s * 0.20, yRadius: s * 0.20).fill()
        NSColor(calibratedRed: 0.27, green: 0.91, blue: 0.78, alpha: 1).setStroke()
    } else { (variant == "light" ? NSColor(calibratedWhite: 0.10, alpha: 1) : NSColor.white).setStroke() }
    let transform = NSAffineTransform()
    let scale = s * (variant == "badge" ? 0.72 : 0.90) / 24
    transform.translateX(by: (s - 24 * scale) / 2, yBy: (s + 24 * scale) / 2)
    transform.scaleX(by: scale, yBy: -scale)
    transform.concat()
    let plug = NSBezierPath()
    plug.move(to: NSPoint(x: 6.3, y: 20.3))
    // Two quarter-circle arcs from the official path, expressed as cubic curves.
    plug.curve(to: NSPoint(x: 9.7, y: 20.3), controlPoint1: NSPoint(x: 7.239, y: 21.239), controlPoint2: NSPoint(x: 8.761, y: 21.239))
    plug.line(to: NSPoint(x: 12, y: 18)); plug.line(to: NSPoint(x: 6, y: 12)); plug.line(to: NSPoint(x: 3.7, y: 14.3))
    plug.curve(to: NSPoint(x: 3.7, y: 17.7), controlPoint1: NSPoint(x: 2.761, y: 15.239), controlPoint2: NSPoint(x: 2.761, y: 16.761))
    plug.close()
    for points: [NSPoint] in [
        [NSPoint(x: 2, y: 22), NSPoint(x: 5, y: 19)],
        [NSPoint(x: 7.5, y: 13.5), NSPoint(x: 10, y: 11)],
        [NSPoint(x: 10.5, y: 16.5), NSPoint(x: 13, y: 14)],
        [NSPoint(x: 18, y: 3), NSPoint(x: 14, y: 7), NSPoint(x: 20, y: 7), NSPoint(x: 16, y: 11)]
    ] {
        plug.move(to: points[0]); for point in points.dropFirst() { plug.line(to: point) }
    }
    plug.lineWidth = size <= 32 ? 2.2 : 2
    plug.lineCapStyle = .round; plug.lineJoinStyle = .round; plug.stroke()
    NSGraphicsContext.restoreGraphicsState()
    guard let png = bitmap.representation(using: .png, properties: [:]) else { exit(2) }
    try png.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(variant)-\(size).png"), options: .withoutOverwriting)
}
for size in [16, 24, 32, 48, 64, 128, 256, 512, 1024] { try draw(size, "badge") }
for variant in ["light", "dark"] { for size in [16, 32, 48] { try draw(size, variant) } }
`;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ["ignore", "ignore", "pipe"], env: {PATH: "/usr/bin:/bin", HOME: process.env.HOME, TMPDIR: process.env.TMPDIR}});
    let diagnostic = "";
    child.stderr.on("data", chunk => {if (diagnostic.length < 4096) diagnostic += chunk;});
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`ICON_BUILD_FAILED (${code}): ${diagnostic}`)));
  });
}

export async function buildDesktopIcons({outputRoot}) {
  if (process.platform !== "darwin" || typeof outputRoot !== "string" || !path.isAbsolute(outputRoot)) throw new Error("ICON_OUTPUT_INVALID");
  // A fresh explicit staging directory prevents replacing unrelated assets.
  await fs.mkdir(outputRoot, {mode: 0o700});
  const source = path.join(outputRoot, "draw.swift"), executable = path.join(outputRoot, "draw-icons");
  await fs.writeFile(source, drawing, {mode: 0o600, flag: "wx"});
  await run("/usr/bin/swiftc", [source, "-o", executable]);
  await run(executable, [outputRoot]);
  const iconset = path.join(outputRoot, "GSAConnector.iconset");
  await fs.mkdir(iconset, {mode: 0o700});
  for (const size of [16, 32, 128, 256, 512]) {
    for (const factor of [1, 2]) {
      await fs.copyFile(path.join(outputRoot, `badge-${size * factor}.png`), path.join(iconset, `icon_${size}x${size}${factor === 2 ? "@2x" : ""}.png`), fs.constants.COPYFILE_EXCL);
    }
  }
  const icns = path.join(outputRoot, "GSAConnector.icns");
  await run("/usr/bin/iconutil", ["-c", "icns", "-o", icns, iconset]);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(size => fs.readFile(path.join(outputRoot, `badge-${size}.png`))));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  pngs.forEach((png, index) => {
    const entry = 6 + index * 16;
    header[entry] = sizes[index] % 256; header[entry + 1] = sizes[index] % 256;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  const ico = path.join(outputRoot, "GSAConnector.ico");
  await fs.writeFile(ico, Buffer.concat([header, ...pngs]), {mode: 0o600, flag: "wx"});
  await fs.unlink(source); await fs.unlink(executable);
  return {icns, ico, trayPngs: ["light", "dark"].flatMap(variant => [16, 32, 48].map(size => path.join(outputRoot, `${variant}-${size}.png`)))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, outputRoot, ...extra] = process.argv.slice(2);
  if (flag !== "--output-root" || !outputRoot || extra.length) throw new Error("Use --output-root with a fresh explicit staging directory");
  buildDesktopIcons({outputRoot}).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
}
