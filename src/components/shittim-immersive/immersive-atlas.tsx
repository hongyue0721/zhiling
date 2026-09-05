"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { layoutAtlas, curvePath, clampZoom } from "./atlas-model";
import type { LearningMapDetail } from "@/components/contracts";
import s from "./scenes.module.css";
export function ImmersiveAtlas({map,completed,selected,onSelect,pulse=0}:{map:LearningMapDetail;completed:ReadonlySet<string>;selected:string|null;onSelect:(id:string)=>void;pulse?:number}) {
  const [mobile,setMobile]=useState(false),[camera,setCamera]=useState({x:0,y:0,zoom:1}),[dragging,setDragging]=useState(false);
  const drag=useRef<{id:number;x:number;y:number;cx:number;cy:number}|null>(null);
  useEffect(()=>{const media=matchMedia("(max-width: 700px)");const change=()=>{setMobile(media.matches);setCamera({x:0,y:0,zoom:1});};change();media.addEventListener("change",change);return()=>media.removeEventListener("change",change);},[]);
  const positions=useMemo(()=>layoutAtlas(map.nodes,map.prerequisites,mobile),[map,mobile]);
  const byId=new Map(positions.map(p=>[p.id,p]));
  function down(event:PointerEvent<HTMLDivElement>){if((event.target as HTMLElement).closest("button,a,input"))return;drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,cx:camera.x,cy:camera.y};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);}
  function move(event:PointerEvent<HTMLDivElement>){const d=drag.current;if(!d||d.id!==event.pointerId)return;setCamera(c=>({...c,x:d.cx+event.clientX-d.x,y:d.cy+event.clientY-d.y}));}
  function up(event:PointerEvent<HTMLDivElement>){if(drag.current?.id===event.pointerId){drag.current=null;setDragging(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
  return <>
    <div className={s.atlasSurface} data-dragging={dragging} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className={s.graph} data-dragging={dragging} style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}>
        <svg className={s.edges} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
          {map.prerequisites.map((edge,index)=>{const a=byId.get(edge.prerequisiteNodeId),b=byId.get(edge.nodeId);if(!a||!b)return null;return <g key={`${edge.nodeId}-${edge.prerequisiteNodeId}-${index}`} data-lit={completed.has(edge.prerequisiteNodeId)}><path className={s.edgeBase} d={curvePath(a,b)}/><path className={s.edgeFlow} d={curvePath(a,b)} style={{animationDelay:`${index*-.55}s`}}/></g>;})}
        </svg>
        {positions.map((point,index)=>{const node=map.nodes.find(n=>n.nodeId===point.id)!;return <button type="button" key={point.id} className={s.node} data-selected={selected===point.id} data-completed={completed.has(point.id)} style={{left:`${point.x}%`,top:`${point.y}%`,animationDelay:`${index*65}ms`}} onClick={()=>onSelect(point.id)} aria-label={`${node.title}${completed.has(point.id)?"，已完成":""}，打开问题`}>
          <span className={s.nodeOrb} aria-hidden="true"><i className={s.nodeRing}/><i className={s.nodeCore}/><b>{completed.has(point.id)?"✓":String(index+1).padStart(2,"0")}</b></span>
          <span className={s.nodeLabel}>{node.title}</span>
        </button>;})}
        {pulse>0&&<i key={pulse} className={s.completionWave} aria-hidden="true"/>}
      </div>
    </div>
    <div className={s.mapHint}>点击节点，进入问题</div>
    <div className={s.mapTools} role="group" aria-label="地图视角">
      <button className={s.tool} aria-label="缩小地图" title="缩小" onClick={()=>setCamera(c=>({...c,zoom:clampZoom(c.zoom-.15)}))}>−</button>
      <button className={s.tool} onClick={()=>setCamera({x:0,y:0,zoom:1})}>复位</button>
      <button className={s.tool} aria-label="放大地图" title="放大" onClick={()=>setCamera(c=>({...c,zoom:clampZoom(c.zoom+.15)}))}>＋</button>
    </div>
  </>;
}
