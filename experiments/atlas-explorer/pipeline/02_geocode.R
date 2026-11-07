# Geocodifica data/work/enderecos.csv com geocodebr (Ipea), que usa o CNEFE 2022 do IBGE.
# Uso: R_LIBS_USER=<lib> GEOCODEBR_CACHE=<pasta> Rscript pipeline/02_geocode.R
# Saída: data/work/geocode.csv com id, lat, lon, precisao, tipo_resultado e desvio_metros.
suppressPackageStartupMessages(library(geocodebr))
cache <- Sys.getenv("GEOCODEBR_CACHE")
if (nzchar(cache)) geocodebr::definir_pasta_cache(cache)
x <- utils::read.csv("data/work/enderecos.csv", colClasses = "character", encoding = "UTF-8")
x$numero[x$numero == ""] <- NA
x$cep[x$cep == ""] <- NA
x$bairro[x$bairro == ""] <- NA
campos <- geocodebr::definir_campos(
  estado = "uf", municipio = "ibge", logradouro = "logradouro",
  numero = "numero", cep = "cep", localidade = "bairro"
)
t0 <- Sys.time()
r <- geocodebr::geocode(
  enderecos = x[, c("id", "uf", "ibge", "logradouro", "numero", "cep", "bairro")],
  campos_endereco = campos, resultado_completo = TRUE,
  resolver_empates = TRUE, resultado_sf = FALSE, verboso = TRUE, cache = TRUE
)
r <- as.data.frame(r)
keep <- intersect(c("id", "lat", "lon", "precisao", "tipo_resultado", "desvio_metros",
                    "endereco_encontrado", "contagem_cnefe", "empate"), names(r))
utils::write.csv(r[, keep], "data/work/geocode.csv", row.names = FALSE, fileEncoding = "UTF-8")
cat("linhas", nrow(r), "tempo", format(Sys.time() - t0), "\n")
print(table(r$precisao, useNA = "ifany"))
