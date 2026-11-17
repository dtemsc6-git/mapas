alter table wksp_dtesc.sgt_enlaces_fo
    add constraint fo_equipo_a_id_fk
        foreign key ( equipo_id_a )
            references wksp_dtesc.sgt_equipos ( id )
        enable;


-- sqlcl_snapshot {"hash":"3c13946f87b07539981290e72da48cd72b660cf5","type":"REF_CONSTRAINT","name":"FO_EQUIPO_A_ID_FK","schemaName":"WKSP_DTESC","sxml":""}