"use client";
import {
  ImmersiveGeneration,
  type ImmersiveGenerationProps,
} from "./shittim-immersive/immersive-generation";
export function HomePage(
  props: Omit<ImmersiveGenerationProps, "initialTopic">,
) {
  return <ImmersiveGeneration {...props} />;
}
