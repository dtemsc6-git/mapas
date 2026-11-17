alter table wksp_dtesc.sgt_enlaces_fo
    add constraint fo_equipo_b_id_fk
        foreign key ( equipo_id_b )
            references wksp_dtesc.sgt_equipos ( id )
        enable;


-- sqlcl_snapshot {"hash":"80e018c1587ef12d00792466914a7ccbb99eec2f","type":"REF_CONSTRAINT","name":"FO_EQUIPO_B_ID_FK","schemaName":"WKSP_DTESC","sxml":""}