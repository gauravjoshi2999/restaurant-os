'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.resolve(__dirname,'..',name),'utf8');
test('Housekeeping is still part of the hotel backend bundle (no data or capability deletion)',()=>{
 const capabilities=require('../assets/owner-capabilities.js');
 for(const type of ['hotel','hybrid']){
  const caps=capabilities.defaults[type];
  assert.ok(caps.includes('housekeeping'));
  assert.ok(caps.includes('hotel_rooms'));
 }
 const owner=read('assets/owner-hospitality.js');
 assert.match(owner,/\.filter\(id=>id!=='housekeeping'\|\|housekeepingVisible\(\)\)/);
 assert.match(owner,/const housekeepingVisible=/);
 assert.match(owner,/roomState\(r\)/);
});
test('Owner Settings controls visibility separately from modules and preserves data',()=>{
 const owner=read('assets/owner-hospitality.js');
 const css=read('assets/owner-hospitality.css');
 assert.match(owner,/id='biteHousekeepingVisibilitySetting'/);
 assert.match(owner,/id="biteShowHousekeeping"/);
 assert.match(owner,/loadHousekeepingDisplay/);
 assert.match(owner,/saveHousekeepingDisplay/);
 assert.match(owner,/show_housekeeping:enabled/);
 assert.match(owner,/prop\(\)\?\.id!==propertyId/);
 assert.match(owner,/renderHousekeepingPreference\(\)/);
 assert.match(owner,/housekeepingVisible\(\)\?\[\['Needs cleaning'/);
 assert.match(owner,/housekeepingVisible\(\)\?'<article class="bh-panel"><h2>Room readiness/);
 assert.match(css,/#biteHousekeepingVisibilitySetting/);
 assert.doesNotMatch(owner,/delete\s+from\s+(?:public\.)?bite_rooms/i);
});
test('Preference table is tenant-readable but only property Owner can insert/update',()=>{
 const sql=read('supabase/migrations/20261116170330_owner_housekeeping_ui_preferences_20261116.sql');
 assert.match(sql,/property_id uuid primary key references public\.bite_properties\(id\)/);
 assert.match(sql,/show_housekeeping boolean not null default false/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.bite_property_ui_preferences from public, anon/);
 assert.match(sql,/for select to authenticated[\s\S]*?private\.bite_can\(property_id,'membership'\)/);
 assert.match(sql,/for insert to authenticated[\s\S]*?private\.bite_can\(property_id,'manage_modules'\)/);
 assert.match(sql,/for update to authenticated[\s\S]*?using \(private\.bite_can\(property_id,'manage_modules'\)\)[\s\S]*?with check \(private\.bite_can\(property_id,'manage_modules'\)\)/);
 assert.doesNotMatch(sql,/grant .* on public\.bite_property_ui_preferences to anon/i);
});
