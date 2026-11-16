/* SYNTHETIC transport for private-copy UI only. Never deployed or API proof. */
(function(){
 const factory=window.supabase.createClient;
 window.supabase.createClient=(...args)=>{
  const c=factory(...args),rpc=c.rpc.bind(c),rows=new Map(),objects=new Map();
  const q={rows,objects,calls:[],downloadCalls:0,deny:false,failFinishAfterCommit:false,failRemove:false,failUpload:false};window.__BITE_DOCUMENT_QA=q;
  c.rpc=async(name,a)=>{
   if(!['bite_guest_document_list','bite_guest_document_command'].includes(name))return rpc(name,a);
   q.calls.push({name,args:structuredClone(a)});
   if(q.deny)return{data:null,error:{code:'42501',message:'Guest document access denied'}};
   const p=window.__BITE_HOTEL_QA.property;if(a.p_property!==p.id)return{data:null,error:{code:'42501',message:'Wrong property'}};
   if(name==='bite_guest_document_list')return{data:[...rows.values()].filter(d=>d.guest_id===a.p_guest&&d.status!=='deleted').map(d=>({...d,can_finish:true})),error:null};
   let d=rows.get(a.p_document);
   if(a.p_action==='begin'){
    if(!d){const v=a.p_details;d={id:a.p_document,guest_id:a.p_guest,...v,object_path:p.id+'/'+a.p_guest+'/'+a.p_document+({'image/png':'.png','image/jpeg':'.jpg','application/pdf':'.pdf'}[v.mime_type]),status:'pending'};rows.set(d.id,d)}
   }
   if(a.p_action==='finish'){
    if(!objects.has(d.object_path))return{data:null,error:{message:'Upload not confirmed'}};
    d.status='ready';if(q.failFinishAfterCommit){q.failFinishAfterCommit=false;throw Error('Synthetic interrupted finish response')}
   }
   if(a.p_action==='forget'){
    if(objects.has(d.object_path))return{data:null,error:{message:'File deletion is not confirmed'}};
    d.status='deleted';
   }
   return{data:{id:d.id,object_path:d.object_path,status:d.status},error:null};
  };
  Object.defineProperty(c,'storage',{value:{from:bucket=>{
   if(bucket!=='bite-guest-documents')throw Error('Unexpected document test bucket');
   return{
    upload:async(path,file,options)=>{
     q.lastUploadOptions=options;
     if(q.holdUpload)await new Promise(done=>q.releaseUpload=done);
     if(q.failUpload){q.failUpload=false;throw Error('Synthetic upload connection lost')}
     if(objects.has(path))return{error:{message:'Already exists',statusCode:'409'}};
     objects.set(path,new Blob([await file.arrayBuffer()],{type:options.contentType}));return{data:{path},error:null};
    },
    download:async path=>{q.downloadCalls++;if(q.holdDownload)await new Promise(done=>q.releaseDownload=done);return{data:objects.get(path),error:objects.has(path)?null:{message:'Not found'}}},
    remove:async paths=>{if(q.failRemove){q.failRemove=false;return{error:{message:'Synthetic deletion not confirmed'}}}for(const path of paths)objects.delete(path);return{data:paths,error:null}},
    createSignedUrl:()=>{throw Error('Guest copies must never receive bearer URLs')}
   };
  }}});
  return c;
 };
})();
