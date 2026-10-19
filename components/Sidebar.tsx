"use client";

import {
  CircleHelp,
  Clapperboard,
  FolderOpen,
  Gauge,
  Layers3,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";

type SidebarProps = {
  onUploadClick: () => void;
  onRandomize: () => void;
  onSettingsClick: () => void;
};

export default function Sidebar({ onUploadClick, onRandomize, onSettingsClick }: SidebarProps) {
  return (
    <aside className="studio-sidebar" aria-label="Studio navigation">
      <a className="brand-mark" href="/" aria-label="Motion AI Studio home">
        <span className="brand-mark-inner"><Clapperboard size={19} strokeWidth={2.2} /></span>
      </a>

      <div className="sidebar-group">
        <span className="sidebar-group-label">WORKSPACE</span>
        <button className="sidebar-link active" type="button" aria-label="Studio" title="Studio">
          <Layers3 size={18} />
          <span className="sidebar-tooltip">Studio</span>
        </button>
        <button className="sidebar-link" type="button" onClick={onUploadClick} aria-label="Reference image" title="Reference image">
          <FolderOpen size={18} />
          <span className="sidebar-tooltip">Reference image</span>
        </button>
        <button className="sidebar-link" type="button" onClick={onRandomize} aria-label="Randomize style" title="Randomize style">
          <WandSparkles size={18} />
          <span className="sidebar-tooltip">Randomize style</span>
        </button>
        <button className="sidebar-link" type="button" onClick={onSettingsClick} aria-label="API settings" title="API settings">
          <Settings2 size={18} />
          <span className="sidebar-tooltip">API settings</span>
        </button>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-status-icon" aria-label="Render engine ready" title="Render engine ready">
          <Gauge size={17} />
          <span className="status-dot" />
        </div>
        <a className="sidebar-link help-link" href="/" aria-label="Help and overview" title="Help and overview">
          <CircleHelp size={18} />
          <span className="sidebar-tooltip">Help &amp; overview</span>
        </a>
        <div className="sidebar-avatar" aria-label="Motion AI Studio workspace">M</div>
      </div>
      <div className="sidebar-sparkle" aria-hidden="true"><Sparkles size={12} /></div>
    </aside>
  );
}
