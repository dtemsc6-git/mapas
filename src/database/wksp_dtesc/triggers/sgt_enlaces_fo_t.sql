create or replace editionable trigger wksp_dtesc.sgt_enlaces_fo_t before
    insert or update on wksp_dtesc.sgt_enlaces_fo
    for each row
begin
    if :new.unidad_medida = 'km' then
        :new.abs_longitud := :new.certificación * 1000;
    elsif :new.unidad_medida = 'm' then
        :new.abs_longitud := :new.certificación / 1;
    elsif :new.unidad_medida = 'cm' then
        :new.abs_longitud := :new.certificación / 100;
    end if; 
    --actualizar info de  
    if inserting then
        :new.creado_el := sysdate;
        :new.creado_por := nvl(wwv_flow.g_user, user);
        :new.actualizado_el := sysdate;
        :new.actualizado_por := nvl(wwv_flow.g_user, user);
    elsif updating then
        :new.actualizado_el := sysdate;
        :new.actualizado_por := nvl(wwv_flow.g_user, user);
    end if;

end;
/

alter trigger wksp_dtesc.sgt_enlaces_fo_t enable;


-- sqlcl_snapshot {"hash":"31f9014600ce1c36f8bca39ae0bc5111ff50acfa","type":"TRIGGER","name":"SGT_ENLACES_FO_T","schemaName":"WKSP_DTESC","sxml":""}