"use client";

import { exposedServerValue } from "./intermediate";

export const value = `${exposedServerValue}:${process.env.SERVER_SECRET}`;
