"use client";

import { identity } from "../modules/identity/public/server";
import { database } from "../platform/database/postgres";
import { send } from "../modules/identity/infrastructure/resend";

void identity;
void database;
void send;
