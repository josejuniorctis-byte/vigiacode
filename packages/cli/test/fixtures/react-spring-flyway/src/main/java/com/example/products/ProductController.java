package com.example.products;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/products")
public class ProductController {
  @GetMapping
  public List<ProductDto> list() {
    return List.of();
  }

  @GetMapping("/{id}")
  public ProductDto get(@PathVariable Long id) {
    return null;
  }

  @PostMapping
  public ProductDto create() {
    return null;
  }
}
