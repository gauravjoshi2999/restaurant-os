'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {geometry}=require('../assets/owner-mobile-forms.js');
const base={width:390,height:900,baseline:900,visualHeight:900,offsetTop:0,scale:1,owner:true,editing:true};
test('visual keyboard shrink anchors actions above the actual visual bottom',()=>{
 assert.deepEqual(geometry({...base,visualHeight:500}),{open:true,bottom:400});
 assert.deepEqual(geometry({...base,visualHeight:500,offsetTop:80}),{open:true,bottom:320});
});
test('layout-resizing Android WebView still detects the keyboard from its baseline',()=>{
 assert.deepEqual(geometry({...base,height:480,visualHeight:480}),{open:true,bottom:0});
 assert.deepEqual(geometry(base),{open:false,bottom:0});
});
test('pinch zoom, desktop, non-editable controls and Admin do not alter Owner navigation',()=>{
 for(const change of [{scale:1.5},{width:1440},{editing:false},{owner:false}])
  assert.deepEqual(geometry({...base,visualHeight:400,...change}),{open:false,bottom:0});
});
