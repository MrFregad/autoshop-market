import { createClient } from '@supabase/supabase-js';

// Твой URL из скриншота
const supabaseUrl = 'https://vhvedefyixgluayqahhh.supabase.co'; 

// ВСТАВЬ СЮДА СВОЙ public anon КЛЮЧ
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM'; 

export const supabase = createClient(supabaseUrl, supabaseAnonKey);