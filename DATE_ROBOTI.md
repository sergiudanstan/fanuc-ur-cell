# Datele roboților

| constantă | valoare | sursă |
| --- | --- | --- |
| UR.lim[2] | 320 ° | https://www.universal-robots.com/manuals/EN/HTML/SW10_13/Content/prod-usr-man/complianceUR5e/H_g5_sections/appendix_g5/tech_spec_sheet.htm |
| UR.lim[2].lo | -160 ° | https://www.universal-robots.com/manuals/EN/HTML/SW10_13/Content/prod-usr-man/complianceUR5e/H_g5_sections/appendix_g5/tech_spec_sheet.htm |
| UR.lim[2].hi | 160 ° | https://www.universal-robots.com/manuals/EN/HTML/SW10_13/Content/prod-usr-man/complianceUR5e/H_g5_sections/appendix_g5/tech_spec_sheet.htm |

Intervalul J1 de 340° corespunde cursei normale FANUC. Fișa pentru America indică și 360° ca variantă. Dimensiunile geometrice și vitezele din model urmează specificația celulei și sursele de mai jos.

- [Fișa FANUC LR Mate 200iD/7L](https://www.fanucamerica.com/uploads/files/data-sheets/lr-mate-200id-7l-datasheet.pdf?preview=)
- [Parametrii DH publicați de Universal Robots](https://www.universal-robots.com/articles/ur/application-installation/dh-parameters-for-calculations-of-kinematics-and-dynamics/)

## Verificare cinematică independentă

Pentru fiecare robot, am compus separat translațiile și rotațiile cu cuaternioni folosind dimensiunile din specificație. Configurațiile (J1…J6), în grade, au fost `[0, 0, 0, 0, 0, 0]` și `[35, -32, 57, 42, -50, 65]`. Am comparat poziția mondială a flanșei cu penultimul punct din `Links`, apoi poziția și orientarea TCP cu `FK`.

| robot | abatere maximă flanșă | abatere maximă TCP | abatere maximă orientare |
| --- | ---: | ---: | ---: |
| FANUC | < 0,000001 mm | < 0,000001 mm | < 0,000002° |
| UR5e | < 0,000001 mm | < 0,000001 mm | < 0,000002° |

Cu o copie temporară pentru fiecare robot, mărirea modulului lui `a2` cu 10 mm a produs 10,000 mm abatere la flanșă și TCP față de aceleași referințe.
