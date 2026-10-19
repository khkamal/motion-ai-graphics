import StudioWorkspace from "@/components/StudioWorkspace";
import { resolveFfmpegPath } from "@/lib/videoProcessor";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Studio workspace — Motion AI Studio",
  description: "Build a unique image-to-motion direction and render a 4K motion master.",
};

export default function DashboardPage() {
  let renderEngineAvailable = true;
  try {
    resolveFfmpegPath();
  } catch {
    renderEngineAvailable = false;
  }
  return <StudioWorkspace renderEngineAvailable={renderEngineAvailable} />;
}
